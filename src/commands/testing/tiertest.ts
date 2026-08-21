import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Mode, Region } from '../../config/constants';
import { startTesting, stopTesting, setTesterAvailable, resetAllTesters } from '../../services/testerService';
import { COLORS, MODES } from '../../config/constants';
import prisma from '../../database/prisma';

const ALL_MODES: Mode[] = ['sword', 'axe', 'nethpot', 'dpot', 'uhc', 'smp', 'crystal', 'mace'];

export default {
  data: new SlashCommandBuilder()
    .setName('tiertest')
    .setDescription('Manage your tier testing session.')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start testing players for a given mode.')
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Mode to test').setRequired(true)
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
          opt.setName('region').setDescription('Filter queue by region (default: All Regions)').setRequired(false)
            .addChoices(
              { name: 'All Regions', value: 'all' },
              { name: 'Asia (AS)', value: 'AS' },
              { name: 'Europe (EU)', value: 'EU' },
              { name: 'North America (NA)', value: 'NA' },
              { name: 'Australia (AU)', value: 'AU' },
              { name: 'South America (SA)', value: 'SA' },
              { name: 'Middle East (ME)', value: 'ME' },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('stop')
        .setDescription('Mark yourself as unavailable for testing.')
    )
    .addSubcommand(sub =>
      sub.setName('available')
        .setDescription('Mark yourself as an available tester for a given mode.')
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Mode to be available for').setRequired(true)
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
      sub.setName('unavailable')
        .setDescription('Mark yourself as unavailable for testing (Alias for stop).')
    )
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('[Admin] Reset all active testers (fixes stuck panel data).')
    )
    .addSubcommand(sub =>
      sub.setName('force-stop')
        .setDescription('[Admin] Force stop an active tester.')
        .addUserOption(o => o.setName('user').setDescription('The tester to force stop').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('admin')
        .setDescription('[Admin] Grant a user full bot admin permissions (Tier Admin + Manager roles).')
        .addUserOption(o => o.setName('user').setDescription('User to grant full bot admin access').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('ticket-category')
        .setDescription('[Admin] Set the ticket category for a specific mode.')
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Mode to configure').setRequired(true)
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
          opt.setName('category')
            .setDescription('Category ID where tickets will be created')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    
    // Force fetch member from Discord API so latest assigned roles are immediately present
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);

    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? (member?.roles.cache.has(roleIds.tierManager) ?? false) : false);

    // Helper to verify tester permission for a mode: MUST be staff OR have the exact tester role for this mode
    const canTestMode = (mode: Mode): boolean => {
      if (isStaff) return true;
      if (!member) return false;
      const modeTesterRoleId = roleIds.testers?.[mode];
      if (modeTesterRoleId && member.roles.cache.has(modeTesterRoleId)) return true;
      const modeNameLower = MODES[mode]?.toLowerCase();
      return member.roles.cache.some(r => r.name.toLowerCase() === `${modeNameLower} tester`);
    };

    await interaction.deferReply({ ephemeral: true });

    // ── /tiertest start ────────────────────────────────────────────────────────
    if (sub === 'start') {
      const mode = interaction.options.getString('mode', true) as Mode;
      const region = (interaction.options.getString('region') as Region | 'all') || 'all';

      if (!canTestMode(mode)) {
        return interaction.editReply({
          content: `❌ You do not have the **${MODES[mode]} Tester** role. Ask a Tier Manager to assign it to you.`,
        });
      }

      // Check if there are already active testers
      const activeCount = await prisma.tester.count({
        where: { guildId: interaction.guild.id, active: true, activeMode: mode },
      });

      if (activeCount > 0) {
        return interaction.editReply({
          content: `❌ Another tester is already running the queue for **${MODES[mode]}**. To join them as an available tester, use \`/tiertest available mode:${mode}\` instead.`,
        });
      }

      const result = await startTesting(interaction.guild, interaction.user.id, mode, region);

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Testing Started' : '❌ Could Not Start Test')
        .setDescription(result.message)
        .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest stop ─────────────────────────────────────────────────────────
    if (sub === 'stop') {
      // Any active tester can stop themselves
      const tester = await prisma.tester.findUnique({ where: { discordId: interaction.user.id } });
      if (!tester?.active) {
        return interaction.editReply({ content: '❌ You are not currently active as a tester.' });
      }

      const result = await stopTesting(interaction.guild, interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '⏹️ Testing Stopped' : '❌ Error')
        .setDescription(result.message)
        .setColor(result.success ? COLORS.WARNING : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest unavailable ──────────────────────────────────────────────────
    if (sub === 'unavailable') {
      const tester = await prisma.tester.findUnique({ where: { discordId: interaction.user.id } });
      if (!tester?.active) {
        return interaction.editReply({ content: '❌ You are not currently active as a tester.' });
      }

      const result = await stopTesting(interaction.guild, interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '⏹️ Testing Stopped' : '❌ Error')
        .setDescription(result.message)
        .setColor(result.success ? COLORS.WARNING : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest available ────────────────────────────────────────────────────
    if (sub === 'available') {
      const mode = interaction.options.getString('mode', true) as Mode;

      if (!canTestMode(mode)) {
        return interaction.editReply({
          content: `❌ You do not have the **${MODES[mode]} Tester** role. Ask a Tier Manager to assign it to you.`,
        });
      }

      const activeCount = await prisma.tester.count({
        where: { guildId: interaction.guild.id, active: true, activeMode: mode },
      });

      if (activeCount === 0) {
        return interaction.editReply({
          content: `❌ The queue for **${MODES[mode]}** is not open yet. Use \`/tiertest start mode:${mode}\` to be the primary tester and open the queue.`,
        });
      }

      const result = await setTesterAvailable(interaction.guild, interaction.user.id, mode);

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Marked Available' : '❌ Error')
        .setDescription(result.message)
        .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest reset ────────────────────────────────────────────────────────
    if (sub === 'reset') {
      if (!isAdmin) {
        return interaction.editReply({ content: '❌ Only Tier Admins and Administrators can reset testers.' });
      }

      const result = await resetAllTesters(interaction.guild);

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Testers Reset' : '❌ Error')
        .setDescription(result.message)
        .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest force-stop ───────────────────────────────────────────────────
    if (sub === 'force-stop') {
      if (!isAdmin && !isStaff) {
        return interaction.editReply({ content: '❌ Only Tier Admins and Managers can force stop a tester.' });
      }

      const targetUser = interaction.options.getUser('user', true);
      const tester = await prisma.tester.findUnique({ where: { discordId: targetUser.id } });

      if (!tester?.active) {
        return interaction.editReply({ content: `❌ <@${targetUser.id}> is not currently active as a tester.` });
      }

      const result = await stopTesting(interaction.guild, targetUser.id, 'Closed by Admin');

      const embed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Tester Force Stopped' : '❌ Error')
        .setDescription(result.success ? `Successfully stopped <@${targetUser.id}>'s testing session.` : result.message)
        .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest admin ────────────────────────────────────────────────────────
    if (sub === 'admin') {
      if (!isAdmin) {
        return interaction.editReply({ content: '❌ Only Tier Admins and Administrators can grant admin access.' });
      }

      const user = interaction.options.getUser('user', true);
      const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) return interaction.editReply({ content: '❌ Could not find that member in the server.' });

      const added: string[] = [];

      if (roleIds.tierAdmin) {
        try { await targetMember.roles.add(roleIds.tierAdmin); added.push('Tier Admin'); } catch {}
      }
      if (roleIds.tierManager) {
        try { await targetMember.roles.add(roleIds.tierManager); added.push('Tier Manager'); } catch {}
      }

      const embed = new EmbedBuilder()
        .setTitle('👑 Full Bot Admin Access Granted')
        .setDescription(
          `<@${user.id}> has been granted full bot admin permissions.\n\n` +
          `They can now:\n` +
          `• Use all \`/tiertest\`, \`/tiertester\` and \`/tieradmin\` commands\n` +
          `• Start, stop & manage all tier test sessions for any mode\n` +
          `• Assign & remove testers for any mode`
        )
        .addFields(
          { name: '✅ Roles Added', value: added.length ? added.join(', ') : 'None', inline: false },
        )
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /tiertest ticket-category ──────────────────────────────────────────────
    if (sub === 'ticket-category') {
      if (!isAdmin) {
        return interaction.editReply({ content: '❌ Only Tier Admins and Administrators can configure ticket categories.' });
      }

      const mode = interaction.options.getString('mode', true) as Mode;
      const categoryId = interaction.options.getString('category', true);

      const categoryIds = (guildConfig?.categoryIds as Record<string, any>) ?? {};

      // Migrate old string format to per-mode object
      if (typeof categoryIds.tickets === 'string') {
        const oldId = categoryIds.tickets;
        categoryIds.tickets = {};
        for (const m of ALL_MODES) {
          categoryIds.tickets[m] = oldId;
        }
      } else {
        categoryIds.tickets = categoryIds.tickets ?? {};
      }

      categoryIds.tickets[mode] = categoryId;

      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { categoryIds: categoryIds as any },
      });

      return interaction.editReply({
        content: `✅ Ticket category for **${MODES[mode]}** set to \`${categoryId}\`.`,
      });
    }
  },
};
