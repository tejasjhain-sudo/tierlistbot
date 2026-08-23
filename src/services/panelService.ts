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

/**
 * Ensures ONLY ONE panel message exists in a channel.
 * Edits existing panel if available, or deletes all previous bot messages before sending a new one.
 */
export async function sendSinglePanel(
  channel: TextChannel,
  embed: EmbedBuilder,
  components: ActionRowBuilder<any>[],
  knownMsgId?: string | null
): Promise<string> {
  // 1. Try to edit known message
  if (knownMsgId) {
    try {
      const existing = await channel.messages.fetch(knownMsgId);
      if (existing && existing.author.id === channel.client.user?.id) {
        await existing.edit({ embeds: [embed], components });
        cleanDuplicateBotMessages(channel, [existing.id]).catch(() => {});
        return existing.id;
      }
    } catch {
      // Message no longer exists
    }
  }

  // 2. Clean up previous bot messages in channel to avoid duplicates
  try {
    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const botMessages = Array.from(recentMessages.values()).filter(
      (m) => m.author.id === channel.client.user?.id
    );

    for (const botMsg of botMessages) {
      try {
        await botMsg.delete();
      } catch {}
    }
  } catch {}

  // 3. Send fresh panel
  const newMsg = await channel.send({ embeds: [embed], components });
  return newMsg.id;
}

async function cleanDuplicateBotMessages(channel: TextChannel, keepMsgIds: string[]): Promise<void> {
  try {
    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const duplicates = Array.from(recentMessages.values()).filter(
      (m) => m.author.id === channel.client.user?.id && !keepMsgIds.includes(m.id)
    );
    for (const dup of duplicates) {
      try {
        await dup.delete();
      } catch {}
    }
  } catch {}
}

// ─── Verification & Registration Panel (Sent to #request-test) ───────────────
export function buildRegistrationEmbed(guild: Guild): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📝 Tier Testing Registration')
    .setDescription(
      `Welcome to **${guild.name}** Tier Testing!\n\n` +
      `• Click **Register Minecraft IGN** to link your Minecraft username and unlock queue access.\n` +
      `• Click **Enter Waitlist** to select your kit queue and start testing.\n` +
      `• Click **View Cooldown** to check your remaining wait time between tests.\n\n` +
      `🛑 **Failure to provide authentic information will result in a denied test.**`
    )
    .setColor('#990033')
    .setFooter({ text: 'RearMC Tierlist System • Instant Registration' })
    .setTimestamp();
}

export function buildRegistrationComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_account')
      .setLabel('📝 Register Minecraft IGN')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('enter_waitlist')
      .setLabel('⚔️ Enter Waitlist')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('view_cooldown')
      .setLabel('⏳ View Cooldown')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('action_start_update')
      .setLabel('⚙️ Update Account')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('my_profile')
      .setLabel('👤 My Profile')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

export async function sendOrUpdateRegistrationPanel(guild: Guild): Promise<void> {
  const lockKey = `register:${guild.id}`;
  const previousPromise = panelUpdateQueues.get(lockKey) || Promise.resolve();

  const currentPromise = previousPromise.then(async () => {
    try {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
      if (!guildConfig) return;

      const channelIds = (guildConfig.channelIds as Record<string, any>) || {};
      const registerChannelId = channelIds.register;
      if (!registerChannelId) return;

      const channel = guild.channels.cache.get(registerChannelId) as TextChannel | undefined;
      if (!channel) return;

      const embed = buildRegistrationEmbed(guild);
      const components = buildRegistrationComponents();
      const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) || {};

      const msgId = await sendSinglePanel(channel, embed, components, panelMessageIds.register);
      panelMessageIds.register = msgId;

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
  const activeTesters = await prisma.tester.findMany({
    where: { guildId: guild.id, active: true, activeMode: mode },
  });

  const queueEntries = await prisma.queueEntry.findMany({
    where: { guildId: guild.id, mode, status: QueueStatus.WAITING },
    include: { player: true },
    orderBy: { joinedAt: 'asc' },
    take: 20,
  });

  const isTestingOpen = activeTesters.length > 0;
  const queueLimit = 20;

  let description = '';
  description += `**Tester(s) Available!**\n\n`;
  description += `Use /leave if you wish to be removed from the waitlist or queue.\n\n`;
  description += `**Queue** (${queueEntries.length}/${queueLimit}):\n`;

  if (queueEntries.length === 0) {
    description += `_No players currently in queue._\n\n`;
  } else {
    queueEntries.forEach((entry, index) => {
      const ign = entry.player?.minecraftUsername ?? 'Unknown';
      description += `${index + 1}. **${ign}**\n`;
    });
    description += '\n';
  }

  description += `**Active Testers:**\n`;
  if (activeTesters.length === 0) {
    description += `_No testers currently active._\n\n`;
  } else {
    activeTesters.forEach((tester) => {
      description += `• <@${tester.discordId}>\n`;
    });
    description += '\n';
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${MODES[mode]} Tier Testing Waitlist`)
    .setDescription(description)
    .setColor(isTestingOpen ? COLORS.SUCCESS : COLORS.DANGER)
    .setTimestamp();

  return { embed, isTestingOpen };
}

export function buildWaitlistButtons(mode: Mode, isTestingOpen: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_join_${mode}`)
      .setLabel(isTestingOpen ? 'Join Queue' : 'Testing Closed')
      .setStyle(isTestingOpen ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!isTestingOpen),
    new ButtonBuilder()
      .setCustomId(`queue_leave_${mode}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`queue_position_${mode}`)
      .setLabel('My Position')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`queue_refresh_${mode}`)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
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
      const panelMessageIds = (guildConfig.panelMessageIds as Record<string, any>) || {};
      const existingMsgId = panelMessageIds?.waitlists?.[mode];

      if (!isTestingOpen) {
        if (existingMsgId) {
          try {
            const existing = await channel.messages.fetch(existingMsgId);
            await existing.delete();
          } catch {}
          await setPanelMsgId(guild.id, ['waitlists', mode], null);
        }
        return;
      }

      const components = buildWaitlistButtons(mode, isTestingOpen);
      const msgId = await sendSinglePanel(channel, embed, components, existingMsgId);
      await setPanelMsgId(guild.id, ['waitlists', mode], msgId);
    } catch (e) {
      console.error(`Error updating waitlist panel for ${mode}:`, e);
    }
  });

  panelUpdateQueues.set(lockKey, currentPromise);
  await currentPromise;
}

export async function sendOrUpdateAllWaitlistPanels(guild: Guild): Promise<void> {
  const modes: Mode[] = ['sword', 'axe', 'nethpot', 'dpot', 'uhc', 'smp', 'crystal', 'mace'];
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

  const panelMessageIds = guildConfig.panelMessageIds as Record<string, any>;
  const closedMsgId = panelMessageIds?.waitlists?.[mode];
  if (closedMsgId) {
    try {
      const oldMsg = await channel.messages.fetch(closedMsgId);
      await oldMsg.delete();
    } catch {}
  }

  const msg = await channel.send(
    `${rolePing} 🟢 **Testing is now OPEN!** <@${testerDiscordId}> has started testing **${MODES[mode]}**. Join the queue now!`
  );

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

  const panelMessageIds = guildConfig.panelMessageIds as Record<string, any>;
  const openPingId = panelMessageIds?.openPings?.[mode];
  if (openPingId) {
    try {
      const oldPing = await channel.messages.fetch(openPingId);
      await oldPing.delete();
    } catch {}
    await setPanelMsgId(guild.id, ['openPings', mode], null);
  }

  const existingWaitlistPanelId = panelMessageIds?.waitlists?.[mode];
  if (existingWaitlistPanelId) {
    try {
      const oldPanel = await channel.messages.fetch(existingWaitlistPanelId);
      await oldPanel.delete();
    } catch {}
    await setPanelMsgId(guild.id, ['waitlists', mode], null);
  }

  try {
    const recent = await channel.messages.fetch({ limit: 15 });
    const botMessages = Array.from(recent.values()).filter(m => m.author.id === channel.client.user?.id);
    for (const bMsg of botMessages) {
      try { await bMsg.delete(); } catch {}
    }
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle(`🛑 ${MODES[mode]} Testing Closed`)
    .setDescription(
      `Testing for **${MODES[mode]}** has ended.\n\n` +
      `**Reason:** ${reason}\n\n` +
      `_You will be pinged automatically when a tester opens the queue again!_`
    )
    .setColor(COLORS.DANGER)
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
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
      const supportChId = channelIds.support || channelIds.requestSupport;
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
      const msgId = await sendSinglePanel(channel, embed, [row], panelMessageIds.support);
      panelMessageIds.support = msgId;

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
      const msgId = await sendSinglePanel(channel, embed, [row], panelMessageIds.testerApp);
      panelMessageIds.testerApp = msgId;

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

// ─── Master function to check and send/update ALL panels across the server ─────
export async function sendOrUpdateAllServerPanels(guild: Guild): Promise<void> {
  await Promise.allSettled([
    sendOrUpdateRegistrationPanel(guild),
    sendOrUpdateSupportPanel(guild),
    sendOrUpdateTesterAppPanel(guild),
    sendOrUpdateAllWaitlistPanels(guild),
  ]);
}
