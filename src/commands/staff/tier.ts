import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES } from '../../config/constants';
import { Mode } from '../../config/constants';

const ALL_MODES: Mode[] = ['sword', 'axe', 'nethpot', 'dpot', 'uhc', 'smp', 'crystal', 'mace'];

export default {
  data: new SlashCommandBuilder()
    .setName('tier')
    .setDescription('Tier management commands.')
    .addSubcommandGroup(group =>
      group
        .setName('staff')
        .setDescription('Staff role management.')
        .addSubcommand(sub =>
          sub
            .setName('assign')
            .setDescription('Assign a staff role (Tier Tester / Manager / Admin) to a user.')
            .addUserOption(o => o.setName('user').setDescription('User to assign role to').setRequired(true))
            .addStringOption(o =>
              o.setName('role')
                .setDescription('Staff role to assign')
                .setRequired(true)
                .addChoices(
                  { name: 'Tier Tester (all modes)', value: 'tierTester' },
                  { name: 'Tier Manager', value: 'tierManager' },
                  { name: 'Tier Admin', value: 'tierAdmin' },
                  { name: 'Sword Tester', value: 'tester_sword' },
                  { name: 'Axe Tester', value: 'tester_axe' },
                  { name: 'Netherite Pot Tester', value: 'tester_nethpot' },
                  { name: 'Diamond Pot Tester', value: 'tester_dpot' },
                  { name: 'UHC Tester', value: 'tester_uhc' },
                  { name: 'SMP Tester', value: 'tester_smp' },
                  { name: 'Crystal Tester', value: 'tester_crystal' },
                  { name: 'Mace Tester', value: 'tester_mace' },
                )
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('unassign')
            .setDescription('Remove a staff role from a user.')
            .addUserOption(o => o.setName('user').setDescription('User to remove role from').setRequired(true))
            .addStringOption(o =>
              o.setName('role')
                .setDescription('Staff role to remove')
                .setRequired(true)
                .addChoices(
                  { name: 'Tier Tester (all modes)', value: 'tierTester' },
                  { name: 'Tier Manager', value: 'tierManager' },
                  { name: 'Tier Admin', value: 'tierAdmin' },
                  { name: 'Sword Tester', value: 'tester_sword' },
                  { name: 'Axe Tester', value: 'tester_axe' },
                  { name: 'Netherite Pot Tester', value: 'tester_nethpot' },
                  { name: 'Diamond Pot Tester', value: 'tester_dpot' },
                  { name: 'UHC Tester', value: 'tester_uhc' },
                  { name: 'SMP Tester', value: 'tester_smp' },
                  { name: 'Crystal Tester', value: 'tester_crystal' },
                  { name: 'Mace Tester', value: 'tester_mace' },
                )
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List all current staff members and their roles.')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    let member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null) ?? undefined;

    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? member?.roles.cache.has(roleIds.tierAdmin) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? member?.roles.cache.has(roleIds.tierManager) : false);

    if (!isStaff) {
      return interaction.reply({ content: '❌ Only Tier Managers and Tier Admins can use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (group === 'staff' && (sub === 'assign' || sub === 'unassign')) {
      const user = interaction.options.getUser('user', true);
      const roleChoice = interaction.options.getString('role', true);

      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that user in the server.' });

      // Admins-only actions
      if (roleChoice === 'tierAdmin' && !isAdmin) {
        return interaction.editReply({ content: '❌ Only Tier Admins can assign the Tier Admin role.' });
      }

      let roleId: string | undefined;
      let roleName: string;

      if (roleChoice.startsWith('tester_')) {
        const mode = roleChoice.replace('tester_', '') as Mode;
        roleId = roleIds.testers?.[mode];
        roleName = `${MODES[mode]} Tester`;

        // Try to find by name if not in config
        if (!roleId) {
          const found = interaction.guild.roles.cache.find(r => {
            const n = r.name.toLowerCase();
            return n.includes(MODES[mode].toLowerCase()) && n.includes('test');
          });
          roleId = found?.id;
        }
      } else {
        roleId = roleIds[roleChoice];
        roleName = roleChoice === 'tierTester' ? 'Tier Tester' : roleChoice === 'tierManager' ? 'Tier Manager' : 'Tier Admin';
      }

      if (!roleId) {
        return interaction.editReply({
          content: `❌ No **${roleName!}** role configured. Run \`/setup\` first or ensure the role exists.`,
        });
      }

      const action = sub === 'assign' ? 'add' : 'remove';
      try {
        await targetMember.roles[action](roleId);
      } catch {
        return interaction.editReply({
          content: `❌ Failed to ${sub} role. Make sure the bot's role is **above** the target role in Server Settings → Roles.`,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(sub === 'assign' ? '✅ Staff Role Assigned' : '🗑️ Staff Role Removed')
        .setDescription(
          sub === 'assign'
            ? `<@${user.id}> has been assigned **${roleName!}**.`
            : `<@${user.id}> has had **${roleName!}** removed.`
        )
        .setColor(sub === 'assign' ? COLORS.SUCCESS : COLORS.DANGER)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (group === 'staff' && sub === 'list') {
      await interaction.guild.members.fetch();

      const lines: string[] = [];

      // Tier Admins
      const adminRoleId = roleIds.tierAdmin;
      const adminRole = adminRoleId ? interaction.guild.roles.cache.get(adminRoleId) : null;
      const admins = adminRole?.members.map(m => `<@${m.id}>`).join(', ') || '_None_';
      lines.push(`**👑 Tier Admins:** ${admins}`);

      // Tier Managers
      const managerRoleId = roleIds.tierManager;
      const managerRole = managerRoleId ? interaction.guild.roles.cache.get(managerRoleId) : null;
      const managers = managerRole?.members.filter(m => !adminRole?.members.has(m.id)).map(m => `<@${m.id}>`).join(', ') || '_None_';
      lines.push(`**⚙️ Tier Managers:** ${managers}`);

      lines.push('');
      lines.push('**🎮 Mode Testers:**');

      for (const mode of ALL_MODES) {
        const modeRoleId = roleIds.testers?.[mode];
        const modeRole = modeRoleId ? interaction.guild.roles.cache.get(modeRoleId) : null;
        const testers = modeRole?.members.map(m => `<@${m.id}>`).join(', ') || '_None_';
        lines.push(`• **${MODES[mode]}:** ${testers}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('👥 Arix Tier Staff')
        .setDescription(lines.join('\n'))
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
