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
    .setName('tieradmin')
    .setDescription('[Owner] Grant or revoke full Tier Admin power to a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('grant')
        .setDescription('Give a user full Tier Admin access (can manage testers, sessions, roles).')
        .addUserOption(o => o.setName('user').setDescription('User to promote to Tier Admin').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('revoke')
        .setDescription('Remove full Tier Admin access from a user.')
        .addUserOption(o => o.setName('user').setDescription('User to demote').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('manager')
        .setDescription('Give a user Tier Manager access (can assign testers but not admins).')
        .addUserOption(o => o.setName('user').setDescription('User to make Tier Manager').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all current Tier Admins and Managers.')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    let member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null) ?? undefined;
    }

    if (!isOwner && !isAdminPerm) {
      return interaction.reply({
        content: '❌ Only the **server owner** or **Administrators** can use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const tierAdminRoleId: string | undefined = roleIds.tierAdmin;
    const tierManagerRoleId: string | undefined = roleIds.tierManager;

    const sub = interaction.options.getSubcommand();

    // ── /tieradmin grant ───────────────────────────────────────────────────────
    if (sub === 'grant') {
      if (!tierAdminRoleId) {
        return interaction.editReply({
          content: '❌ No **Tier Admin** role configured. Run `/setup` first to configure roles.',
        });
      }

      const user = interaction.options.getUser('user', true);
      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that user in the server.' });

      // Give Tier Admin role
      const added: string[] = [];
      const failed: string[] = [];

      try {
        await targetMember.roles.add(tierAdminRoleId);
        added.push('Tier Admin');
      } catch {
        failed.push('Tier Admin');
      }

      // Also give Tier Manager role if it exists
      if (tierManagerRoleId) {
        try {
          await targetMember.roles.add(tierManagerRoleId);
          added.push('Tier Manager');
        } catch {}
      }

      // Give Tier Tester general role if it exists
      const tierTesterRoleId: string | undefined = roleIds.tierTester;
      if (tierTesterRoleId) {
        try {
          await targetMember.roles.add(tierTesterRoleId);
          added.push('Tier Tester');
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setTitle('👑 Tier Admin Access Granted')
        .setDescription(
          `<@${user.id}> has been promoted to **Tier Admin**.\n\n` +
          `They can now:\n` +
          `• Assign & remove testers for any mode\n` +
          `• Start, stop & manage all tier test sessions\n` +
          `• Use all \`/tiertest\`, \`/tiertester\` and \`/tieradmin\` commands\n` +
          `• Complete or cancel any test session`
        )
        .addFields(
          { name: '✅ Roles Given', value: added.length ? added.join('\n') : 'None', inline: true },
          ...(failed.length ? [{ name: '❌ Failed', value: failed.join('\n'), inline: true }] : []),
        )
        .setColor(COLORS.SUCCESS)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tieradmin revoke ──────────────────────────────────────────────────────
    if (sub === 'revoke') {
      const user = interaction.options.getUser('user', true);
      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that user in the server.' });

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You cannot revoke the server owner\'s access.' });
      }

      const removed: string[] = [];

      if (tierAdminRoleId && targetMember.roles.cache.has(tierAdminRoleId)) {
        try { await targetMember.roles.remove(tierAdminRoleId); removed.push('Tier Admin'); } catch {}
      }
      if (tierManagerRoleId && targetMember.roles.cache.has(tierManagerRoleId)) {
        try { await targetMember.roles.remove(tierManagerRoleId); removed.push('Tier Manager'); } catch {}
      }

      // Remove all tester mode roles
      for (const mode of ALL_MODES) {
        const roleId = roleIds.testers?.[mode];
        if (roleId && targetMember.roles.cache.has(roleId)) {
          try {
            await targetMember.roles.remove(roleId);
            removed.push(`${MODES[mode]} Tester`);
          } catch {}
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('🚫 Tier Admin Access Revoked')
        .setDescription(
          removed.length
            ? `<@${user.id}>'s Tier Admin access has been fully revoked.`
            : `<@${user.id}> had no Tier Admin roles to remove.`
        )
        .addFields(
          { name: '🗑️ Roles Removed', value: removed.length ? removed.join('\n') : 'None', inline: false },
        )
        .setColor(COLORS.DANGER)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tieradmin manager ─────────────────────────────────────────────────────
    if (sub === 'manager') {
      if (!tierManagerRoleId) {
        return interaction.editReply({
          content: '❌ No **Tier Manager** role configured. Run `/setup` first to configure roles.',
        });
      }

      const user = interaction.options.getUser('user', true);
      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that user in the server.' });

      try {
        await targetMember.roles.add(tierManagerRoleId);
      } catch {
        return interaction.editReply({ content: '❌ Failed to add the Tier Manager role. Check bot permissions.' });
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Tier Manager Access Granted')
        .setDescription(
          `<@${user.id}> is now a **Tier Manager**.\n\n` +
          `They can:\n` +
          `• Assign testers for specific modes\n` +
          `• Start & manage test sessions\n` +
          `• Use \`/tiertester add/remove\` commands\n\n` +
          `*They cannot grant Tier Admin roles — use \`/tieradmin grant\` for that.*`
        )
        .setColor(COLORS.PRIMARY)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tieradmin list ────────────────────────────────────────────────────────
    if (sub === 'list') {
      const guild = interaction.guild;
      await guild.members.fetch(); // cache all members

      const adminRole = tierAdminRoleId ? guild.roles.cache.get(tierAdminRoleId) : null;
      const managerRole = tierManagerRoleId ? guild.roles.cache.get(tierManagerRoleId) : null;

      const admins = adminRole
        ? adminRole.members.map(m => `<@${m.id}>`).join('\n') || '_None_'
        : '_Role not configured_';

      const managers = managerRole
        ? managerRole.members.filter(m => !adminRole?.members.has(m.id)).map(m => `<@${m.id}>`).join('\n') || '_None_'
        : '_Role not configured_';

      const embed = new EmbedBuilder()
        .setTitle('👥 Tier Admin & Manager List')
        .addFields(
          { name: '👑 Tier Admins', value: admins, inline: true },
          { name: '⚙️ Tier Managers', value: managers, inline: true },
        )
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
