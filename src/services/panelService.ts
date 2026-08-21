import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  Guild,
  Message,
  DiscordAPIError,
} from 'discord.js';
import { Mode, QueueStatus } from '../config/constants';
import prisma from '../database/prisma';
import { COLORS, MODES, REGIONS } from '../config/constants';
import { config } from '../config';

// ─── In-memory locks to prevent concurrent duplicate panel sends ───────────────
// Key format: 'register:{guildId}' or 'waitlist:{guildId}:{mode}'
const panelUpdateQueues = new Map<string, Promise<void>>();

async function setPanelMsgId(guildId: string, path: string[], value: string | null): Promise<void> {
  const config = await prisma.guildConfig.findUnique({ where: { guildId } });
  if (!config) return;

  const panelMessageIds = (config.panelMessageIds as Record<string, any>) || {};

  if (path.length === 2) {
    if (!panelMessageIds[path[0]] || typeof panelMessageIds[path[0]] !== 'object') {
      panelMessageIds[path[0]] = {};
    }
    panelMessageIds[path[0]][path[1]] = value;
  } else if (path.length === 1) {
    panelMessageIds[path[0]] = value;
  }

  await prisma.guildConfig.update({
    where: { guildId },
    data: { panelMessageIds }
  });
}

// ─── Registration Panel ───────────────────────────────────────────────────────
export function buildRegistrationEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📝 Evaluation Testing Waitlist')
    .setDescription(
      'Upon applying, you will be added to a waitlist channel.\n' +
      'Here you will be pinged when a tester of your region is available.\n' +
      'If you are HT3 or higher, a high ticket will be created.\n\n' +
      '• Region should be the region of the server you wish to test on\n\n' +
      '• Username should be the name of the account you will be testing on\n\n' +
      '🛑 **Failure to provide authentic information will result in a denied test.**'
    )
    .setColor('#990033')
}

export function buildRegistrationComponents(): ActionRowBuilder<any>[] {
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('verify_account').setLabel('Verify Account').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('enter_waitlist').setLabel('Enter Waitlist').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('view_cooldown').setLabel('View Cooldown').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('action_start_update').setLabel('Update Account').setStyle(ButtonStyle.Primary)
  );

  return [buttonRow];
}

export async function sendOrUpdateRegistrationPanel(guild: Guild): Promise<void> {
  const lockKey = `register:${guild.id}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

      const channelIds = guildConfig.channelIds as Record<string, string>;
      const registerChannelId = channelIds.register;
      if (!registerChannelId) return;

      const channel = guild.channels.cache.get(registerChannelId) as TextChannel | undefined;
      if (!channel) return;

      const embed = buildRegistrationEmbed();
      const components = buildRegistrationComponents();

      const panelMessageIds = guildConfig.panelMessageIds as Record<string, string>;

      if (panelMessageIds.register) {
        try {
          const existing = await channel.messages.fetch(panelMessageIds.register);
          await existing.edit({ embeds: [embed], components });
          return;
        } catch (err) {
          if (!(err instanceof DiscordAPIError && err.code === 10008)) throw err;
          console.warn(`[${guild.name}] Registration panel message gone (10008), sending new one.`);
        }
      }

      const msg = await channel.send({ embeds: [embed], components });
      panelMessageIds.register = msg.id;

      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { panelMessageIds },
      });
    } catch (e) {
      console.error(`Error updating registration panel:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

// ─── Waitlist Panel ───────────────────────────────────────────────────────────
export async function buildWaitlistEmbed(guild: Guild, mode: Mode): Promise<{ embed: EmbedBuilder, isTestingOpen: boolean }> {
  // Active testers
  const activeTesters = await prisma.tester.findMany({
    where: { guildId: guild.id, active: true, activeMode: mode },
  });

  // Queue entries (up to 20)
  const queueEntries = await prisma.queueEntry.findMany({
    where: { guildId: guild.id, mode, status: QueueStatus.WAITING },
    include: { player: true },
    orderBy: { joinedAt: 'asc' },
    take: 20,
  });

  const isTestingOpen = activeTesters.length > 0;
  const queueLimit = 20;

  // Always same format — only button changes
  let description = '';
  description += `**Tester(s) Available!**\n\n`;
  description += `Use /leave if you wish to be removed from the waitlist or queue.\n\n`;

  description += `**Queue** (${queueEntries.length}/${queueLimit}):\n`;
  if (queueEntries.length > 0) {
    description += queueEntries.map((e, i) => `${i + 1}. <@${e.player.discordId}>`).join('\n');
  } else {
    description += '_No players waiting._';
  }

  description += `\n\n**Active Testers:**\n`;
  if (activeTesters.length > 0) {
    description += activeTesters.map((t, i) => `${i + 1}. <@${t.discordId}>`).join('\n');
  } else {
    description += '_None_';
  }

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor(0x2b2d31);

  return { embed, isTestingOpen };
}

export function buildWaitlistButtons(mode: Mode, isTestingOpen: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const joinButton = new ButtonBuilder()
    .setCustomId(`queue_join_${mode}`)
    .setLabel('Join Queue')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!isTestingOpen);

  const leaveButton = new ButtonBuilder()
    .setCustomId(`queue_leave_${mode}`)
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!isTestingOpen);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton, leaveButton)
  ];
}

export async function sendOrUpdateWaitlistPanel(guild: Guild, mode: Mode): Promise<void> {
  const lockKey = `waitlist:${guild.id}:${mode}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

    const channelIds = guildConfig.channelIds as Record<string, any>;
    const waitlistChannelId = channelIds?.waitlists?.[mode];
    if (!waitlistChannelId) return;

    const channel = guild.channels.cache.get(waitlistChannelId) as TextChannel | undefined;
    if (!channel) return;

    const { embed, isTestingOpen } = await buildWaitlistEmbed(guild, mode);

    const panelMessageIds = guildConfig.panelMessageIds as Record<string, any>;
    const existingMsgId = panelMessageIds?.waitlists?.[mode];

    // If testing is offline, delete the persistent panel completely.
    if (!isTestingOpen) {
      if (existingMsgId) {
        try {
          const existing = await channel.messages.fetch(existingMsgId);
          await existing.delete();
        } catch {
          // Message already gone
        }

        if (panelMessageIds.waitlists) {
          await setPanelMsgId(guild.id, ['waitlists', mode], null);
        }
      }
      return;
    }

    // Testing is open: build components and send/update the panel
    const components = buildWaitlistButtons(mode, isTestingOpen);

    if (existingMsgId) {
      try {
        const existing = await channel.messages.fetch(existingMsgId);
        await existing.edit({ embeds: [embed], components });
        return;
      } catch (err) {
        // Only fall through to send a new panel if the message genuinely no longer exists.
        if (!(err instanceof DiscordAPIError && err.code === 10008)) throw err;
        console.warn(`[${guild.name}] Waitlist panel for ${mode} gone (10008), sending new one.`);
      }
    }

      const msg = await channel.send({ embeds: [embed], components });
      await setPanelMsgId(guild.id, ['waitlists', mode], msg.id);
    } catch (e) {
      console.error(`Error updating waitlist panel for ${mode}:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

export async function sendOrUpdateAllWaitlistPanels(guild: Guild): Promise<void> {
  const modes: Mode[] = ['sword', 'axe', 'nethpot', 'dpot', 'uhc', 'smp', 'crystal', 'mace'];
  // Run all panel updates in parallel for speed
  await Promise.all(modes.map(mode => sendOrUpdateWaitlistPanel(guild, mode)));
}

// ─── Ping waitlist role when testing opens ────────────────────────────────────
export async function pingTestingOpen(guild: Guild, mode: Mode, testerDiscordId: string): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  if (!guildConfig) return;

  const channelIds = guildConfig.channelIds as Record<string, any>;
  const roleIds = guildConfig.roleIds as Record<string, any>;

  const waitlistChannelId = channelIds?.waitlists?.[mode];
  const waitlistRoleId = roleIds?.waitlists?.[mode];

  if (!waitlistChannelId) return;

  const channel = guild.channels.cache.get(waitlistChannelId) as TextChannel | undefined;
  if (!channel) return;

  const rolePing = waitlistRoleId ? `<@&${waitlistRoleId}>` : '';

  // Delete ONLY the saved "Queue Closed" embed — nothing else
  const panelMessageIds = guildConfig.panelMessageIds as Record<string, any>;
  const closedMsgId = panelMessageIds?.waitlists?.[mode];
  if (closedMsgId) {
    try {
      const oldMsg = await channel.messages.fetch(closedMsgId);
      await oldMsg.delete();
    } catch {
      // Already deleted or not found — ignore
    }
  }

  const msg = await channel.send(
    `${rolePing} 🟢 **Testing is now OPEN!** <@${testerDiscordId}> has started testing **${MODES[mode]}**. Join the queue now!`
  );

  // Atomic writes: clear closed-message ID, save open-ping ID
  await setPanelMsgId(guild.id, ['waitlists', mode], null);
  await setPanelMsgId(guild.id, ['openPings', mode], msg.id);
}

// ─── Notify when testing closes ─────────────────────────────────────────────────
export async function pingTestingClosed(
  guild: Guild,
  mode: Mode,
  reason: string = 'Queue manually ended by command'
): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  if (!guildConfig) return;

  const channelIds = guildConfig.channelIds as Record<string, any>;
  const waitlistChannelId = channelIds?.waitlists?.[mode];
  if (!waitlistChannelId) return;

  const channel = guild.channels.cache.get(waitlistChannelId) as TextChannel | undefined;
  if (!channel) return;

  const modeName = MODES[mode];
  const closedAt = new Date();
  const timestamp = `<t:${Math.floor(closedAt.getTime() / 1000)}:f>`;

  const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) ?? {};

  // 1. Delete open waitlist panel message if exists
  const existingMsgId = panelMessageIds?.waitlists?.[mode];
  if (existingMsgId) {
    try {
      const existing = await channel.messages.fetch(existingMsgId);
      await existing.delete();
    } catch {}
  }

  // 2. Delete "Testing is now OPEN" ping message if exists
  const openPingMsgId = panelMessageIds?.openPings?.[mode];
  if (openPingMsgId) {
    try {
      const openPingMsg = await channel.messages.fetch(openPingMsgId);
      await openPingMsg.delete();
    } catch {}
    await setPanelMsgId(guild.id, ['openPings', mode], null);
  }

  // 3. Fallback: Search and delete any remaining recent open messages or panels in channel
  try {
    const recentMessages = await channel.messages.fetch({ limit: 25 });
    const openPings = recentMessages.filter(m => 
      m.content.includes('Testing is now OPEN!') || 
      m.author.id === guild.client.user?.id
    );
    for (const [, openMsg] of openPings) {
      try { await openMsg.delete(); } catch {}
    }
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle(`🔒 ${modeName} Queue Closed`)
    .setDescription(
      'This testing session has ended. You will be notified here when a new queue opens.\n\n' +
      `📋 **Reason**\n${reason}\n\n` +
      `⏰ **Session Ended**\n${timestamp}\n\n` +
      '*Thank you for testing!*'
    )
    .setColor(COLORS.DANGER);

  const msg = await channel.send({ embeds: [embed] });

  // Save the Queue Closed message ID so it can be deleted when the queue opens again
  await setPanelMsgId(guild.id, ['waitlists', mode], msg.id);
}

// ─── Support Panel ────────────────────────────────────────────────────────────
export async function sendOrUpdateSupportPanel(guild: Guild): Promise<void> {
  const lockKey = `support:${guild.id}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

      const channelIds = (guildConfig.channelIds as Record<string, any>) ?? {};
      const supportChId = channelIds.support;
      let channel: TextChannel | undefined;

      if (supportChId) {
        channel = guild.channels.cache.get(supportChId) as TextChannel | undefined;
      }
      if (!channel) {
        channel = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('request-support') || c.name.includes('support'))) as TextChannel | undefined;
      }
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle('🛠️ RearMC Server Support')
        .setDescription(
          `Need assistance from the RearMC Support Team?\n\n` +
          `• **General Queries & Help**\n` +
          `• **Tier Rank Verification Issues**\n` +
          `• **Bug Reports & Feedback**\n\n` +
          `Click **Request Support** below to open a private ticket!`
        )
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('request_support_prompt')
          .setLabel('🛠️ Request Support')
          .setStyle(ButtonStyle.Primary)
      );

      const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) ?? {};

      if (panelMessageIds.support) {
        try {
          const existing = await channel.messages.fetch(panelMessageIds.support);
          await existing.edit({ embeds: [embed], components: [row] });
          return;
        } catch (err) {
          if (!(err instanceof DiscordAPIError && err.code === 10008)) throw err;
          console.warn(`[${guild.name}] Support panel message gone, sending new one.`);
        }
      }

      const msg = await channel.send({ embeds: [embed], components: [row] });
      panelMessageIds.support = msg.id;

      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { panelMessageIds },
      });
    } catch (e) {
      console.error(`Error updating support panel:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

// ─── Tester Application Panel ────────────────────────────────────────────────
export async function sendOrUpdateTesterAppPanel(guild: Guild): Promise<void> {
  const lockKey = `tester_app:${guild.id}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

      const channelIds = (guildConfig.channelIds as Record<string, any>) ?? {};
      const appChId = channelIds.applications;
      let channel: TextChannel | undefined;

      if (appChId) {
        channel = guild.channels.cache.get(appChId) as TextChannel | undefined;
      }
      if (!channel) {
        channel = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('applications') || c.name.includes('apply'))) as TextChannel | undefined;
      }
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle('📝 Tier Tester Applications')
        .setDescription(
          `Want to join the RearMC Tierlist Staff Team as an official **Tier Tester**?\n\n` +
          `• **Requirements:** Authentic gameplay knowledge, activity, and objective testing.\n` +
          `• **Responsibilities:** Evaluate players in queue, issue accurate tiers, and update test logs.\n\n` +
          `Click **Apply for Tester** below to submit your application!`
        )
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('apply_tester_prompt')
          .setLabel('📝 Apply for Tester')
          .setStyle(ButtonStyle.Primary)
      );

      const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) ?? {};

      if (panelMessageIds.testerApp) {
        try {
          const existing = await channel.messages.fetch(panelMessageIds.testerApp);
          await existing.edit({ embeds: [embed], components: [row] });
          return;
        } catch (err) {
          if (!(err instanceof DiscordAPIError && err.code === 10008)) throw err;
          console.warn(`[${guild.name}] Tester app panel message gone, sending new one.`);
        }
      }

      const msg = await channel.send({ embeds: [embed], components: [row] });
      panelMessageIds.testerApp = msg.id;

      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { panelMessageIds },
      });
    } catch (e) {
      console.error(`Error updating tester application panel:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

// ─── Verification Auth Panel (OAuth & Server Access) ─────────────────────────
export async function sendOrUpdateVerificationAuthPanel(guild: Guild): Promise<void> {
  const lockKey = `verify_auth:${guild.id}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

      const channelIds = (guildConfig.channelIds as Record<string, any>) ?? {};
      const verifyChId = channelIds.verifyChannel || channelIds.verify;
      let channel: TextChannel | undefined;

      if (verifyChId) {
        channel = guild.channels.cache.get(verifyChId) as TextChannel | undefined;
      }
      if (!channel) {
        channel = guild.channels.cache.find(c => c.isTextBased() && (c.name.includes('verify') || c.name.includes('verification'))) as TextChannel | undefined;
      }
      if (!channel) return;

      const authUrl = `https://discord.com/oauth2/authorize?client_id=${config.discordClientId}&response_type=code&redirect_uri=${encodeURIComponent(config.publicApiUrl + '/api/auth/callback')}&scope=identify+guilds.join&prompt=consent`;

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Server Verification')
        .setDescription(
          `Welcome to **${guild.name}**!\n\n` +
          `To unlock full access to all server channels, announcements, events, and tier testing queues, please complete your verification.\n\n` +
          `Click the **Verify Account** button below to complete verification and unlock the server immediately.`
        )
        .setColor(COLORS.PRIMARY)
        .setFooter({ text: 'RearMC Verification System • Instant Server Access' })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_server_access')
          .setLabel('✅ Verify Account')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel('🔒 Backup & Auto-Join (OAuth)')
          .setStyle(ButtonStyle.Link)
          .setURL(authUrl)
      );

      const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) ?? {};

      if (panelMessageIds.verifyAuth) {
        try {
          const existing = await channel.messages.fetch(panelMessageIds.verifyAuth);
          await existing.edit({ embeds: [embed], components: [row] });
          return;
        } catch (err) {
          if (!(err instanceof DiscordAPIError && err.code === 10008)) throw err;
          console.warn(`[${guild.name}] Verification auth panel message gone, sending new one.`);
        }
      }

      const msg = await channel.send({ embeds: [embed], components: [row] });
      panelMessageIds.verifyAuth = msg.id;

      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { panelMessageIds },
      });
    } catch (e) {
      console.error(`Error updating verification auth panel:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

// ─── Master function to check and send/update ALL panels across the server ─────
export async function sendOrUpdateAllServerPanels(guild: Guild): Promise<void> {
  await Promise.allSettled([
    sendOrUpdateVerificationAuthPanel(guild),
    sendOrUpdateRegistrationPanel(guild),
    sendOrUpdateSupportPanel(guild),
    sendOrUpdateTesterAppPanel(guild),
    sendOrUpdateAllWaitlistPanels(guild),
  ]);
}

// END OF FILE
