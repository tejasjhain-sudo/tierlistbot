import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  Guild,
  OverwriteType,
  OverwriteResolvable,
} from 'discord.js';
import prisma from '../../database/prisma';
import { MODES } from '../../config/constants';
import { sendOrUpdateAllServerPanels } from '../../services/panelService';

async function getOrCreateCategory(
  guild: Guild,
  name: string,
  overwrites: OverwriteResolvable[] = []
) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()
  );
  let created = false;
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
    });
    created = true;
  }
  return { category, created };
}

async function getOrCreateChannel(
  guild: Guild,
  name: string,
  type: ChannelType.GuildText | ChannelType.GuildVoice = ChannelType.GuildText,
  parentId?: string,
  overwrites: OverwriteResolvable[] = []
) {
  let channel = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === name.toLowerCase() && (!parentId || c.parentId === parentId)
  );
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type,
      parent: parentId,
      permissionOverwrites: overwrites,
    });
    created = true;
  }
  return { channel, created };
}

export default {
  data: new SlashCommandBuilder()
    .setName('setup-missing-channels')
    .setDescription('[Admin] Scan server and automatically create any missing or rest channels/categories.')
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

    const createdChannels: string[] = [];
    const existingChannels: string[] = [];

    // Fetch existing guild configuration
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) || {};
    const channelIds: Record<string, any> = (guildConfig?.channelIds as Record<string, any>) || { waitlists: {} };

    const tierTesterRoleId = roleIds.tierTester || guild.roles.cache.find(r => r.name.toLowerCase() === 'tier tester')?.id;
    const tierAdminRoleId = roleIds.tierAdmin || guild.roles.cache.find(r => r.name.toLowerCase() === 'tier admin')?.id;

    // ─── 1. Category: ' | Important ──────────────────────────────────────────
    const catImportant = await getOrCreateCategory(guild, "' | Important");
    if (catImportant.created) createdChannels.push(`📁 **Category:** ' | Important`);

    const importantList = [
      { key: 'rules', name: '📜・rules' },
      { key: 'announcements', name: '📢・announcement' },
      { key: 'updates', name: '📰・updates' },
      { key: 'events', name: '🥇・events' },
      { key: 'website', name: '📜・website' },
      { key: 'tierTagger', name: '🏷️・tier-tagger' },
      { key: 'tournament', name: '📅・tournament' },
      { key: 'tournamentUpdates', name: '📅・tournament-updates' },
    ];

    for (const item of importantList) {
      const res = await getOrCreateChannel(guild, item.name, ChannelType.GuildText, catImportant.category.id);
      channelIds[item.key] = res.channel.id;
      if (res.created) createdChannels.push(`• #${item.name}`);
      else existingChannels.push(`• #${item.name}`);
    }

    // ─── 2. Category: ' | Requests ───────────────────────────────────────────
    const catRequests = await getOrCreateCategory(guild, "' | Requests");
    if (catRequests.created) createdChannels.push(`📁 **Category:** ' | Requests`);

    const requestsList = [
      { key: 'register', name: '📩・request-test' },
      { key: 'requestSupport', name: '💳・request-support' },
      { key: 'applications', name: '📝・applications' },
      { key: 'staffApplications', name: '📩・staff-applications' },
    ];

    for (const item of requestsList) {
      const res = await getOrCreateChannel(guild, item.name, ChannelType.GuildText, catRequests.category.id);
      channelIds[item.key] = res.channel.id;
      if (res.created) createdChannels.push(`• #${item.name}`);
      else existingChannels.push(`• #${item.name}`);
    }

    // ─── 3. Category: ' | Tierlists ──────────────────────────────────────────
    const catTierlists = await getOrCreateCategory(guild, "' | Tierlists");
    if (catTierlists.created) createdChannels.push(`📁 **Category:** ' | Tierlists`);

    const tierlistsList = [
      { key: 'testingRules', name: '📌・testing-rules' },
      { key: 'staffMovements', name: '💫・staff-movements' },
      { key: 'punishments', name: '❌・punishments' },
      { key: 'highResults', name: '🏆・high-results' },
      { key: 'results', name: '🏆・results' },
      { key: 'demotions', name: '🔻・demotions' },
      { key: 'verifiedServers', name: '✅・verified-servers' },
    ];

    for (const item of tierlistsList) {
      const res = await getOrCreateChannel(guild, item.name, ChannelType.GuildText, catTierlists.category.id);
      channelIds[item.key] = res.channel.id;
      if (res.created) createdChannels.push(`• #${item.name}`);
      else existingChannels.push(`• #${item.name}`);
    }

    // ─── 4. Category: ' | Waitlist (Locked Channels) ─────────────────────────
    const catWaitlist = await getOrCreateCategory(guild, "' | Waitlist", [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
      },
    ]);
    if (catWaitlist.created) createdChannels.push(`📁 **Category:** ' | Waitlist`);

    channelIds.waitlists = channelIds.waitlists || {};
    for (const modeKey of Object.keys(MODES)) {
      const chName = `waitlist-${modeKey}`;
      const res = await getOrCreateChannel(guild, chName, ChannelType.GuildText, catWaitlist.category.id, [
        {
          id: guild.roles.everyone.id,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        },
      ]);
      channelIds.waitlists[modeKey] = res.channel.id;
      if (res.created) createdChannels.push(`• #${chName}`);
      else existingChannels.push(`• #${chName}`);
    }

    // ─── 5. Category: ' | Support Tickets ────────────────────────────────────
    const catSupport = await getOrCreateCategory(guild, "' | Support Tickets");
    if (catSupport.created) createdChannels.push(`📁 **Category:** ' | Support Tickets`);

    // ─── 6. Category: 🛠️ Tier Testers ─────────────────────────────────────────
    const testerOverwrites: OverwriteResolvable[] = [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ];
    if (tierTesterRoleId) {
      testerOverwrites.push({
        id: tierTesterRoleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect],
      });
    }

    const catTesters = await getOrCreateCategory(guild, '🛠️ Tier Testers', testerOverwrites);
    if (catTesters.created) createdChannels.push(`📁 **Category:** 🛠️ Tier Testers`);

    const testerChat = await getOrCreateChannel(guild, '💬・tester-chat', ChannelType.GuildText, catTesters.category.id);
    channelIds.testerChat = testerChat.channel.id;
    if (testerChat.created) createdChannels.push(`• #💬・tester-chat`);

    const testerVC = await getOrCreateChannel(guild, '🔊・Tester VC', ChannelType.GuildVoice, catTesters.category.id);
    channelIds.testerVoice = testerVC.channel.id;
    if (testerVC.created) createdChannels.push(`• 🔊・Tester VC`);

    // ─── 7. Category: Admin logs ─────────────────────────────────────────────
    const adminOverwrites: OverwriteResolvable[] = [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ];
    if (tierAdminRoleId) {
      adminOverwrites.push({
        id: tierAdminRoleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      });
    }

    const catLogs = await getOrCreateCategory(guild, 'Admin logs', adminOverwrites);
    if (catLogs.created) createdChannels.push(`📁 **Category:** Admin logs`);

    const logsList = [
      { key: 'botLogs', name: 'logs' },
      { key: 'staffLogs', name: 'staff-logs' },
      { key: 'automodLogs', name: 'olympus-automod' },
      { key: 'personalChats', name: 'personal-chats' },
      { key: 'tournamentLogs', name: 'tournament-logs' },
      { key: 'antinukeLogs', name: 'olympus-antinuke-logs' },
    ];

    for (const item of logsList) {
      const res = await getOrCreateChannel(guild, item.name, ChannelType.GuildText, catLogs.category.id);
      channelIds[item.key] = res.channel.id;
      if (res.created) createdChannels.push(`• #${item.name}`);
    }

    // ─── 8. Category: 🏆 TOURNAMENT REVIEW ──────────────────────────────────
    const catReview = await getOrCreateCategory(guild, '🏆 TOURNAMENT REVIEW', adminOverwrites);
    if (catReview.created) createdChannels.push(`📁 **Category:** 🏆 TOURNAMENT REVIEW`);

    // Save updated configuration to database
    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: { channelIds },
      create: {
        guildId: guild.id,
        channelIds,
        roleIds: {},
        categoryIds: {},
        panelMessageIds: {},
      },
    });

    // Deploy or refresh server panels
    try {
      await sendOrUpdateAllServerPanels(guild);
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle('🔧 Server Channels Scan & Setup Complete')
      .setDescription(
        createdChannels.length > 0
          ? `Successfully created **${createdChannels.length}** missing channels/categories and linked them to the database!\n\n` +
            `### 🆕 **Created Channels:**\n${createdChannels.slice(0, 20).join('\n')}${createdChannels.length > 20 ? '\n...and more' : ''}`
          : `✅ **All channels are already up-to-date!** No missing channels needed to be created.`
      )
      .setColor(createdChannels.length > 0 ? 0x57F287 : 0x5865F2)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
