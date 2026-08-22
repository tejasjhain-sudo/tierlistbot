import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { MODES } from '../../config/constants';
import { sendOrUpdateAllServerPanels } from '../../services/panelService';

export default {
  data: new SlashCommandBuilder()
    .setName('fetch-channels')
    .setDescription('[Admin] Auto-scan and link all existing server channels & waitlists to the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only Server Administrators can run this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });
    const guild = interaction.guild;
    await guild.channels.fetch();

    const channels = Array.from(guild.channels.cache.values());

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const channelIds: Record<string, any> = (guildConfig?.channelIds as Record<string, any>) || {};
    const waitlists: Record<string, string> = channelIds.waitlists || {};

    const linkedWaitlists: string[] = [];
    const linkedChannels: string[] = [];

    // Helper to find channel by keyword
    const findChannel = (...keywords: string[]): TextChannel | undefined => {
      return channels.find(
        (c) =>
          c.isTextBased() &&
          keywords.some((k) => c.name.toLowerCase().includes(k.toLowerCase()))
      ) as TextChannel | undefined;
    };

    // 1. Scan and link waitlist channels
    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      const waitlistCh = findChannel(`waitlist-${modeKey}`, `${modeKey}-waitlist`, `waitlist_${modeKey}`, modeKey);
      if (waitlistCh) {
        waitlists[modeKey] = waitlistCh.id;
        linkedWaitlists.push(`• **${modeLabel}:** <#${waitlistCh.id}>`);
      }
    }
    channelIds.waitlists = waitlists;

    // 2. Scan core interaction channels
    const registerCh = findChannel('request-test', 'register', 'verification', 'apply-test');
    if (registerCh) {
      channelIds.register = registerCh.id;
      linkedChannels.push(`• **Registration/Waitlist Panel:** <#${registerCh.id}>`);
    }

    const supportCh = findChannel('request-support', 'support-ticket', 'tickets', 'ticket');
    if (supportCh) {
      channelIds.requestSupport = supportCh.id;
      linkedChannels.push(`• **Support Ticket Panel:** <#${supportCh.id}>`);
    }

    const resultsCh = findChannel('results', 'tier-results', 'tierlist-results');
    if (resultsCh) {
      channelIds.results = resultsCh.id;
      linkedChannels.push(`• **Tier Results Channel:** <#${resultsCh.id}>`);
    }

    const highResultsCh = findChannel('high-results', 'ht-results', 'high-tier-results');
    if (highResultsCh) {
      channelIds.highResults = highResultsCh.id;
      linkedChannels.push(`• **High Tier Results:** <#${highResultsCh.id}>`);
    }

    const testerAppCh = findChannel('applications', 'tester-apps', 'tester-applications');
    if (testerAppCh) {
      channelIds.applications = testerAppCh.id;
      linkedChannels.push(`• **Tester Applications:** <#${testerAppCh.id}>`);
    }

    const staffAppCh = findChannel('staff-applications', 'staff-apply');
    if (staffAppCh) {
      channelIds.staffApplications = staffAppCh.id;
      linkedChannels.push(`• **Staff Applications:** <#${staffAppCh.id}>`);
    }

    const testerChatCh = findChannel('tester-chat', 'testers-chat', 'testers');
    if (testerChatCh) {
      channelIds.testerChat = testerChatCh.id;
      linkedChannels.push(`• **Tester Chat:** <#${testerChatCh.id}>`);
    }

    const logCh = findChannel('logs', 'bot-logs', 'admin-logs');
    if (logCh) {
      channelIds.botLogs = logCh.id;
      linkedChannels.push(`• **Bot Logs:** <#${logCh.id}>`);
    }

    // 3. Scan & link Roles
    const roleIds: Record<string, any> = (guildConfig?.roleIds as Record<string, any>) || {};
    const waitlistRoles: Record<string, string> = roleIds.waitlists || {};
    const testerRoles: Record<string, string> = roleIds.testers || {};

    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      const wRole = guild.roles.cache.find((r) =>
        r.name.toLowerCase().includes(`${modeLabel.toLowerCase()} waitlist`) ||
        r.name.toLowerCase().includes(`${modeKey.toLowerCase()} waitlist`)
      );
      if (wRole) waitlistRoles[modeKey] = wRole.id;

      const tRole = guild.roles.cache.find((r) =>
        r.name.toLowerCase().includes(`${modeLabel.toLowerCase()} tester`) ||
        r.name.toLowerCase().includes(`${modeKey.toLowerCase()} tester`)
      );
      if (tRole) testerRoles[modeKey] = tRole.id;
    }
    roleIds.waitlists = waitlistRoles;
    roleIds.testers = testerRoles;

    const registeredRole = guild.roles.cache.find((r) => r.name.toLowerCase() === 'registered');
    if (registeredRole) roleIds.registered = registeredRole.id;

    const testerRole = guild.roles.cache.find((r) => r.name.toLowerCase() === 'tier tester');
    if (testerRole) roleIds.tierTester = testerRole.id;

    const adminRole = guild.roles.cache.find((r) => r.name.toLowerCase() === 'tier admin');
    if (adminRole) roleIds.tierAdmin = adminRole.id;

    // 4. Save to Database
    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: {
        channelIds,
        roleIds,
      },
      create: {
        guildId: guild.id,
        channelIds,
        roleIds,
        categoryIds: {},
        panelMessageIds: {},
      },
    });

    // 5. Deploy / Refresh Waitlist Panels & Register Panels in detected channels
    try {
      await sendOrUpdateAllServerPanels(guild);
    } catch (panelErr) {
      console.error('Error refreshing panels during fetch-channels:', panelErr);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔗 Server Channels & Waitlists Linked Successfully')
      .setDescription(
        `The bot has scanned **${channels.length}** channels in your server and automatically connected them to the tierlist system!\n\n` +
        `### ⚔️ **Linked Gamemode Waitlists (${linkedWaitlists.length}):**\n` +
        (linkedWaitlists.length > 0 ? linkedWaitlists.join('\n') : '_No waitlist channels found matching gamemodes._') +
        `\n\n### 📋 **Core Panels & Channels (${linkedChannels.length}):**\n` +
        (linkedChannels.length > 0 ? linkedChannels.join('\n') : '_No core channels detected._') +
        `\n\n✅ **Waitlist Panels and Registration Panels have been refreshed in all detected channels!**`
      )
      .setColor(0x57F287)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
