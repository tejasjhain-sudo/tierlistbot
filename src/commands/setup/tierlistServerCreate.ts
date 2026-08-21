import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ColorResolvable,
  OverwriteResolvable,
  OverwriteType,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES, TIERS, TIER_COLORS } from '../../config/constants';
import { Mode, Region, Tier } from '../../config/constants';
import { sendOrUpdateAllServerPanels } from '../../services/panelService';
import { syncAllGuildMembers } from '../../services/roleService';
import { buildResultEmbed } from '../../services/ticketService';

export default {
  data: new SlashCommandBuilder()
    .setName('tierlist-server-create')
    .setDescription('[Admin] Automatically generate the entire Minecraft Tierlist server layout, roles & perms.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt =>
      opt
        .setName('clean_first')
        .setDescription('Delete existing old channels before creating new layout? (Default: False)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('sync_roles')
        .setDescription('Auto-assign Registered & Tier roles to all existing members? (Default: True)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('sync_results')
        .setDescription('Post all past tier test results into the results channels? (Default: False)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only Server Administrators can run this setup.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    const guild = interaction.guild;
    const cleanFirst = interaction.options.getBoolean('clean_first') ?? false;

    if (cleanFirst) {
      const channels = await guild.channels.fetch();
      for (const [, ch] of channels) {
        if (ch) {
          try {
            await ch.delete('Cleaning server for Tierlist template');
          } catch (e) {}
        }
      }
    }

    // ─── 1. Create Base Management & Staff Roles ─────────────────────────────
    const adminRole = await getOrCreateRole(guild, 'Tier Admin', '#E74C3C', true, [
      PermissionFlagsBits.Administrator,
    ]);
    const managerRole = await getOrCreateRole(guild, 'Tier Manager', '#E67E22', true, [
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ]);
    const generalTesterRole = await getOrCreateRole(guild, 'Tier Tester', '#00FFAA', true);
    const registeredRole = await getOrCreateRole(guild, 'Registered', '#3498DB', false);

    // ─── 2. Create Kit Tester Roles ──────────────────────────────────────────
    const testerRoleMap: Record<string, string> = {};
    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      const roleName = `${modeLabel} Tester`;
      const role = await getOrCreateRole(guild, roleName, '#00FFAA', true);
      testerRoleMap[modeKey] = role.id;
    }

    // ─── 3. Create Waitlist Roles ────────────────────────────────────────────
    const waitlistRoleMap: Record<string, string> = {};
    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      const roleName = `${modeLabel} Waitlist`;
      const role = await getOrCreateRole(guild, roleName, '#5865F2', false);
      waitlistRoleMap[modeKey] = role.id;
    }

    // ─── 4. Create All Tier Roles (HT1-HT5, LT1-LT5 for each kit) ────────────
    const tierRoleMap: Record<string, Record<string, string>> = {};
    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      tierRoleMap[modeKey] = {};
      for (const tierKey of TIERS) {
        const roleName = `${modeLabel} ${tierKey}`;
        const color = (TIER_COLORS[tierKey as Tier] as ColorResolvable) || '#95A5A6';
        const role = await getOrCreateRole(guild, roleName, color, true);
        tierRoleMap[modeKey][tierKey] = role.id;
      }
    }

    // ─── 5. Create Ping Roles ────────────────────────────────────────────────
    await getOrCreateRole(guild, 'Testing Ping', '#F1C40F', false);
    await getOrCreateRole(guild, 'Announcements Ping', '#3498DB', false);
    await getOrCreateRole(guild, 'Events Ping', '#9B59B6', false);
    await getOrCreateRole(guild, 'Updates Ping', '#E91E63', false);

    const staffRoleIds = [adminRole.id, managerRole.id, generalTesterRole.id, ...Object.values(testerRoleMap)];

    // ─── 6. Create Categories & Channels ─────────────────────────────────────
    const channelIdMap: Record<string, any> = {
      waitlists: {},
    };

    // Category 1: ' | Important
    const catImportant = await getOrCreateCategory(guild, "' | Important");
    const rulesCh = await getOrCreateChannel(guild, '📜・rules', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    const announceCh = await getOrCreateChannel(guild, '📢・announcement', ChannelType.GuildAnnouncement, catImportant.id, true, staffRoleIds);
    const updatesCh = await getOrCreateChannel(guild, '📰・updates', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '🥇・events', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '📜・website', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '🏷️・tier-tagger', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '📅・tournament', ChannelType.GuildText, catImportant.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '📅・tournament-updates', ChannelType.GuildText, catImportant.id, true, staffRoleIds);

    channelIdMap.updates = updatesCh.id;

    // Category 2: ' | Requests
    const catRequests = await getOrCreateCategory(guild, "' | Requests");
    const reqTestCh = await getOrCreateChannel(guild, '📩・request-test', ChannelType.GuildText, catRequests.id, true, staffRoleIds);
    const reqSuppCh = await getOrCreateChannel(guild, '💳・request-support', ChannelType.GuildText, catRequests.id, true, staffRoleIds);
    const reqAppCh = await getOrCreateChannel(guild, '📝・applications', ChannelType.GuildText, catRequests.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '📩・staff-applications', ChannelType.GuildText, catRequests.id, true, staffRoleIds);

    channelIdMap.register = reqTestCh.id;
    channelIdMap.support = reqSuppCh.id;
    channelIdMap.applications = reqAppCh.id;

    // Category 3: ' | Tierlists
    const catTierlists = await getOrCreateCategory(guild, "' | Tierlists");
    await getOrCreateChannel(guild, '📌・testing-rules', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '💫・staff-movements', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '❌・punishments', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    const highResultsCh = await getOrCreateChannel(guild, '🏆・high-results', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    const resultsCh = await getOrCreateChannel(guild, '🏆・results', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '🔻・demotions', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);
    await getOrCreateChannel(guild, '✅・verified-servers', ChannelType.GuildText, catTierlists.id, true, staffRoleIds);

    channelIdMap.history = resultsCh.id;
    channelIdMap.highResults = highResultsCh.id;

    // Category 4: ' | Waitlist (Locked Channels)
    const catWaitlist = await getOrCreateCategory(guild, "' | Waitlist");
    for (const [modeKey, modeLabel] of Object.entries(MODES)) {
      const waitlistRoleId = waitlistRoleMap[modeKey];
      const specificTesterId = testerRoleMap[modeKey];

      const overwrites: OverwriteResolvable[] = [
        {
          id: guild.roles.everyone.id,
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: adminRole.id,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: managerRole.id,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ];

      if (specificTesterId) {
        overwrites.push({
          id: specificTesterId,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      if (waitlistRoleId) {
        overwrites.push({
          id: waitlistRoleId,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        });
      }

      const wlCh = await getOrCreateChannel(
        guild,
        `waitlist-${modeKey.toLowerCase()}`,
        ChannelType.GuildText,
        catWaitlist.id,
        false,
        [],
        overwrites
      );
      channelIdMap.waitlists[modeKey] = wlCh.id;
    }

    // Category 5: ' | Support Tickets
    await getOrCreateCategory(guild, "' | Support Tickets");

    // Category 6: 🛠️ Tier Testers (Tester Private Hub)
    const catTesters = await getOrCreateCategory(guild, '🛠️ Tier Testers', [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      ...staffRoleIds.map(id => ({
        id,
        type: OverwriteType.Role,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      })),
    ]);
    await getOrCreateChannel(guild, '💬・tester-chat', ChannelType.GuildText, catTesters.id);
    await getOrCreateChannel(guild, '🔊・Tester VC', ChannelType.GuildVoice, catTesters.id);

    // Category 7: Admin logs (Private to Tier Admin & Manager)
    const catLogs = await getOrCreateCategory(guild, 'Admin logs', [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: adminRole.id,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: managerRole.id,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ]);
    const botLogsCh = await getOrCreateChannel(guild, 'logs', ChannelType.GuildText, catLogs.id);
    await getOrCreateChannel(guild, 'staff-logs', ChannelType.GuildText, catLogs.id);
    await getOrCreateChannel(guild, 'olympus-automod', ChannelType.GuildText, catLogs.id);
    await getOrCreateChannel(guild, 'personal-chats', ChannelType.GuildText, catLogs.id);
    await getOrCreateChannel(guild, 'tournament-logs', ChannelType.GuildText, catLogs.id);
    await getOrCreateChannel(guild, 'olympus-antinuke-logs', ChannelType.GuildText, catLogs.id);

    channelIdMap.botLogs = botLogsCh.id;

    // Category 8: 🏆 TOURNAMENT REVIEW
    await getOrCreateCategory(guild, '🏆 TOURNAMENT REVIEW', [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: adminRole.id,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ]);

    // ─── 7. Save to Database GuildConfig ──────────────────────────────────────
    const roleIdConfig = {
      tierAdmin: adminRole.id,
      tierManager: managerRole.id,
      tierTester: generalTesterRole.id,
      registered: registeredRole.id,
      testers: testerRoleMap,
      waitlists: waitlistRoleMap,
      tiers: tierRoleMap,
    };

    await prisma.guildConfig.upsert({
      where: { guildId: guild.id },
      update: {
        roleIds: roleIdConfig,
        channelIds: channelIdMap,
      },
      create: {
        guildId: guild.id,
        roleIds: roleIdConfig,
        channelIds: channelIdMap,
        categoryIds: {},
        panelMessageIds: {},
      },
    });

    // ─── 8. Automatically Deploy All Server Panels ───────────────────────────
    try {
      await sendOrUpdateAllServerPanels(guild);
    } catch (panelErr) {
      console.error('Error auto-deploying server panels:', panelErr);
    }

    // ─── 9. Automatically Sync Registered & Tier Roles ───────────────────────
    const syncRoles = interaction.options.getBoolean('sync_roles') ?? true;
    let syncedMembersCount = 0;
    if (syncRoles) {
      try {
        const syncResult = await syncAllGuildMembers(guild);
        syncedMembersCount = syncResult.synced;
      } catch (syncErr) {
        console.error('Error auto-syncing members during setup:', syncErr);
      }
    }

    // ─── 10. Automatically Sync Past Tier Test Results if Requested ──────────
    const syncResults = interaction.options.getBoolean('sync_results') ?? false;
    let resultsPostedCount = 0;
    if (syncResults) {
      try {
        const historyRecords = await prisma.tierHistory.findMany({
          include: { player: true },
          orderBy: { createdAt: 'asc' },
        });

        for (const record of historyRecords) {
          const isHigh = ['HT1', 'HT2', 'HT3', 'HT4'].includes(record.earnedTier);
          const destCh = (isHigh && highResultsCh) ? highResultsCh : resultsCh;
          const earnedTierRoleId = tierRoleMap[record.mode]?.[record.earnedTier];

          const resultEmbed = buildResultEmbed({
            minecraftUsername: record.player.minecraftUsername,
            minecraftUuid: record.player.minecraftUuid,
            testerDiscordId: record.testerDiscordId,
            mode: record.mode as Mode,
            region: record.region as Region,
            previousTier: (record.previousTier as Tier) || null,
            earnedTier: record.earnedTier as Tier,
            earnedTierRoleId,
            sessionId: record.sessionId ?? record.id,
            notes: record.notes ?? undefined,
            evidenceUrl: record.evidenceUrl ?? undefined,
          });

          await destCh.send({ embeds: [resultEmbed] });
          resultsPostedCount++;
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (resErr) {
        console.error('Error auto-posting results during setup:', resErr);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🚀 Minecraft Tierlist Server Setup Complete!')
      .setDescription(
        `The entire professional Tierlist server layout has been successfully built & linked to the bot database!\n\n` +
        `### 📁 **Categories & Channels Created:**\n` +
        `• **' | Important** (rules, announcements, updates, events, website, tournament)\n` +
        `• **' | Requests** (request-test, request-support, applications, staff-apps)\n` +
        `• **' | Tierlists** (testing-rules, staff-movements, punishments, results, high-results, demotions)\n` +
        `• **' | Waitlist** (8 locked gamemode waitlist channels)\n` +
        `• **' | Support Tickets** (Ticket zone)\n` +
        `• **🛠️ Tier Testers** (Private tester chat & voice channel)\n` +
        `• **Admin logs** (logs, staff-logs, automod, personal-chats, tournament-logs)\n` +
        `• **🏆 TOURNAMENT REVIEW** (Review category)\n\n` +
        `### 🛡️ **Roles & Permissions Linked:**\n` +
        `• **Tier Admin & Tier Manager** roles\n` +
        `• **8 Kit Tester Roles** (Sword, Axe, Nethpot, Dpot, UHC, SMP, Crystal, Mace)\n` +
        `• **80 Tier Roles** (HT1–HT5, LT1–LT5 per gamemode)\n` +
        `• **8 Waitlist Roles**\n\n` +
        `### ⚡ **Automations Executed:**\n` +
        `• ✅ **Panels Deployed:** Registration, Support, Tester Applications & Waitlist panels are live!\n` +
        `• 👥 **Roles Synced:** \`${syncedMembersCount}\` members received their Registered & Tier roles\n` +
        (syncResults ? `• 📜 **Results Posted:** \`${resultsPostedCount}\` past results posted\n` : '')
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getOrCreateRole(
  guild: any,
  name: string,
  color: ColorResolvable,
  hoist: boolean,
  permissions?: bigint[]
) {
  let role = guild.roles.cache.find((r: any) => r.name.toLowerCase() === name.toLowerCase());
  if (!role) {
    role = await guild.roles.create({
      name,
      color,
      hoist,
      permissions: permissions ? permissions.reduce((a: bigint, b: bigint) => a | b, 0n) : undefined,
      reason: 'Tierlist Server Creator Auto-Setup',
    });
  }
  return role;
}

async function getOrCreateCategory(guild: any, name: string, overwrites?: OverwriteResolvable[]) {
  let category = guild.channels.cache.find(
    (c: any) => c.name.toLowerCase() === name.toLowerCase() && c.type === ChannelType.GuildCategory
  );
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
    });
  }
  return category;
}

async function getOrCreateChannel(
  guild: any,
  name: string,
  type: ChannelType,
  parentId?: string,
  readOnly = false,
  staffRoleIds: string[] = [],
  customOverwrites?: OverwriteResolvable[]
) {
  let channel = guild.channels.cache.find(
    (c: any) => c.name.toLowerCase() === name.toLowerCase() && c.parentId === parentId
  );

  if (!channel) {
    let overwrites: OverwriteResolvable[] = customOverwrites || [];

    if (!customOverwrites && readOnly) {
      overwrites = [
        {
          id: guild.roles.everyone.id,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads],
        },
      ];
      for (const sId of staffRoleIds) {
        overwrites.push({
          id: sId,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
        });
      }
    }

    const isVoice = type === ChannelType.GuildVoice;
    const isAnnounce = type === ChannelType.GuildAnnouncement && guild.features.includes('COMMUNITY');
    const finalType = isVoice
      ? ChannelType.GuildVoice
      : isAnnounce
      ? ChannelType.GuildAnnouncement
      : ChannelType.GuildText;

    channel = await guild.channels.create({
      name,
      type: finalType,
      parent: parentId,
      permissionOverwrites: overwrites.length > 0 ? overwrites : undefined,
    });
  }

  return channel;
}
