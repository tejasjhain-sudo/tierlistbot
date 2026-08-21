import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES } from '../../config/constants';
import { Mode } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('tester')
    .setDescription('Manage tier testers.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub.setName('assign')
        .setDescription('Give a user tester access for a specific mode.')
        .addUserOption(o => o.setName('user').setDescription('User to add as tester').setRequired(true))
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Mode they can test').setRequired(true)
            .addChoices(
              { name: 'Sword', value: 'sword' },
              { name: 'Axe', value: 'axe' },
              { name: 'Netherite Pot', value: 'nethpot' },
              { name: 'Diamond Pot', value: 'dpot' },
              { name: 'UHC', value: 'uhc' },
              { name: 'SMP', value: 'smp' },
              { name: 'Crystal', value: 'crystal' },
              { name: 'Mace', value: 'mace' },
            )
        )
        .addStringOption(opt =>
          opt.setName('rank').setDescription('Tester rank').setRequired(false)
            .addChoices(
              { name: 'Voluntary Tester', value: 'Voluntary Tester' },
              { name: 'Sr Tester', value: 'Sr Tester' },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a user\'s tester access for a specific mode.')
        .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true))
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Mode to remove access for').setRequired(true)
            .addChoices(
              { name: 'Sword', value: 'sword' },
              { name: 'Axe', value: 'axe' },
              { name: 'Netherite Pot', value: 'nethpot' },
              { name: 'Diamond Pot', value: 'dpot' },
              { name: 'UHC', value: 'uhc' },
              { name: 'SMP', value: 'smp' },
              { name: 'Crystal', value: 'crystal' },
              { name: 'Mace', value: 'mace' },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all currently active testers.')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    // Permission check: must be Tier Manager, Tier Admin, or server Admin/Owner
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    let member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null) ?? undefined;
    }

    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? (member?.roles.cache.has(roleIds.tierManager) ?? false) : false);

    if (!isStaff) {
      return interaction.reply({ content: '❌ Only Tier Managers and Tier Admins can use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    // ── /tester assign ────────────────────────────────────────────────────────
    if (sub === 'assign') {
      const user = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true) as Mode;
      const rank = interaction.options.getString('rank');
      
      const modeLabel = (MODES[mode] || mode).toLowerCase();
      let role = roleIds.testers?.[mode] ? interaction.guild.roles.cache.get(roleIds.testers[mode]) : null;

      if (!role) {
        role = interaction.guild.roles.cache.find(r => {
          const n = r.name.toLowerCase();
          return n === `${modeLabel} tester` || (n.includes(modeLabel) && n.includes('test'));
        }) || null;
      }

      if (!role) {
        return interaction.editReply({
          content: `❌ Could not find a **${MODES[mode]} Tester** role in this server. Please create a role named **${MODES[mode]} Tester** or run /setup.`,
        });
      }

      // Sync roleId back into guildConfig if missing or changed
      if (roleIds.testers?.[mode] !== role.id) {
        roleIds.testers = roleIds.testers ?? {};
        roleIds.testers[mode] = role.id;
        await prisma.guildConfig.update({
          where: { guildId: interaction.guild.id },
          data: { roleIds },
        });
      }

      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that member in the server.' });

      try {
        const rolesToAssign = [role.id];
        
        // Include generic Tier Tester role
        if (roleIds.tierTester) {
          rolesToAssign.push(roleIds.tierTester);
        }

        // Handle Rank Role (create if it doesn't exist)
        let rankRole = null;
        if (rank) {
          rankRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === rank.toLowerCase());
          if (!rankRole) {
            rankRole = await interaction.guild.roles.create({
              name: rank,
              color: rank === 'Sr Tester' ? 0xE74C3C : 0x3498DB,
              reason: 'Created missing tester rank role'
            });
          }
          rolesToAssign.push(rankRole.id);
        }

        await targetMember.roles.add(rolesToAssign);
        
        let desc = `<@${user.id}> was assigned <@&${role.id}>`;
        if (roleIds.tierTester) desc += `, <@&${roleIds.tierTester}>`;
        if (rankRole) desc += `, and <@&${rankRole.id}>`;
        desc += `. They can now test **${MODES[mode]}**.`;

        const embed = new EmbedBuilder()
          .setTitle('✅ Tester Assigned')
          .setDescription(desc)
          .setColor(COLORS.SUCCESS)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to assign roles to <@${user.id}>.\n` +
                   `👉 **Fix:** Go to **Server Settings ➔ Roles** and drag the bot's role **ABOVE** the roles it's trying to assign.`,
        });
      }
    }

    // ── /tester remove ─────────────────────────────────────────────────────
    if (sub === 'remove') {
      const user = interaction.options.getUser('user', true);
      const mode = interaction.options.getString('mode', true) as Mode;
      
      const modeLabel = (MODES[mode] || mode).toLowerCase();
      let role = roleIds.testers?.[mode] ? interaction.guild.roles.cache.get(roleIds.testers[mode]) : null;

      if (!role) {
        role = interaction.guild.roles.cache.find(r => {
          const n = r.name.toLowerCase();
          return n === `${modeLabel} tester` || (n.includes(modeLabel) && n.includes('test'));
        }) || null;
      }

      if (!role) {
        return interaction.editReply({ content: `❌ No tester role found for **${MODES[mode]}**.` });
      }

      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that member in the server.' });

      try {
        await targetMember.roles.remove(role.id);
      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to remove **${role.name}** from <@${user.id}>. Check bot role hierarchy.`,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Tester Removed')
        .setDescription(`<@${user.id}> can no longer test **${MODES[mode]}**.`)
        .setColor(COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tester list ───────────────────────────────────────────────────────
    if (sub === 'list') {
      const activeTesters = await prisma.tester.findMany({
        where: { guildId: interaction.guild.id, active: true },
      });

      const lines = activeTesters.length
        ? activeTesters.map(t =>
            `<@${t.discordId}> — **${t.activeMode}** — started <t:${Math.floor((t.startedAt?.getTime() ?? 0) / 1000)}:R>`
          ).join('\n')
        : '_No active testers right now._';

      const embed = new EmbedBuilder()
        .setTitle('👨‍⚖️ Active Testers')
        .setDescription(lines)
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
