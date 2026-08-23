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
    .setTitle('📝 Server Verification & Registration')
    .setDescription(
      `Welcome to **${guild.name}**!\n\n` +
      `• Click **Register Minecraft IGN** to link your Minecraft username and unlock queue access.\n` +
      `• Click **Enter Waitlist** to select your kit queue and start testing.\n` +
      `• Click **View Cooldown** to check your remaining wait time between tests.\n\n` +
      `🛑 **Failure to provide authentic information will result in a denied test and queue blacklist.**`
    )
    .setColor('#990033')
    .setFooter({ text: 'Arix Tierlist System • Instant Registration' })
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
  if (isTestingOpen) {
    description += `🟢 **Testing is OPEN! Tester(s) Available:**\n`;
    activeTesters.forEach((tester) => {
      description += `• <@${tester.discordId}>\n`;
    });
    description += `\nClick **Join Queue** below to enter the waitlist!\n\n`;
  } else {
    description += `🔴 **Testing is currently CLOSED.**\n_A tester will open this queue when available._\n\n`;
  }

  description += `**Queue** (${queueEntries.length}/${queueLimit}):\n`;

  if (queueEntries.length === 0) {
    description += `_No players currently in queue._\n`;
  } else {
    queueEntries.forEach((entry, index) => {
      const ign = entry.player?.minecraftUsername ?? 'Unknown';
      description += `${index + 1}. **${ign}**\n`;
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${MODES[mode]} Tier Testing Waitlist`)
    .setDescription(description)
    .setColor(isTestingOpen ? COLORS.SUCCESS : COLORS.DANGER)
    .setFooter({ text: 'Arix Tier Testing' })
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
      const channelIds = (guildConfig?.channelIds as Record<string, any>) || {};
      let waitlistChannelId = channelIds?.waitlists?.[mode];

      let channel: TextChannel | undefined;
      if (waitlistChannelId) {
        channel = (guild.channels.cache.get(waitlistChannelId) || await guild.channels.fetch(waitlistChannelId).catch(() => null)) as TextChannel | undefined;
      }

      // Auto-discover waitlist channel by name if not mapped
      if (!channel) {
        const modeAliases: Record<Mode, string[]> = {
          sword: ['sword', 'sword-waitlist'],
          axe: ['axe', 'axe-waitlist'],
          nethpot: ['nethpot', 'netherite-potion', 'netherite-pot', 'neth-pot'],
          dpot: ['dpot', 'diamond-potion', 'diamond-pot', 'dia-pot'],
          uhc: ['uhc', 'uhc-waitlist'],
          smp: ['smp', 'smp-waitlist'],
          crystal: ['crystal', 'crystal-waitlist', 'cpvp'],
          mace: ['mace', 'mace-waitlist'],
        };

        const searchKeywords = modeAliases[mode] || [mode];
        channel = guild.channels.cache.find(c =>
          c.isTextBased() && searchKeywords.some(keyword => c.name.toLowerCase().includes(keyword))
        ) as TextChannel | undefined;

        if (channel && guildConfig) {
          channelIds.waitlists = channelIds.waitlists || {};
          channelIds.waitlists[mode] = channel.id;
          await prisma.guildConfig.update({
            where: { guildId: guild.id },
            data: { channelIds },
          });
        }
      }

      if (!channel) return;

      const { embed, isTestingOpen } = await buildWaitlistEmbed(guild, mode);
      const panelMessageIds = (guildConfig?.panelMessageIds as Record<string, any>) || {};
      const existingMsgId = panelMessageIds?.waitlists?.[mode];

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
  const channelIds = (guildConfig?.channelIds as Record<string, any>) || {};
  const roleIds = (guildConfig?.roleIds as Record<string, any>) || {};

  let waitlistChannelId = channelIds?.waitlists?.[mode];
  let channel: TextChannel | undefined;

  if (waitlistChannelId) {
    channel = (guild.channels.cache.get(waitlistChannelId) || await guild.channels.fetch(waitlistChannelId).catch(() => null)) as TextChannel | undefined;
  }

  const modeAliases: Record<Mode, string[]> = {
    sword: ['sword', 'sword-waitlist'],
    axe: ['axe', 'axe-waitlist'],
    nethpot: ['nethpot', 'netherite-potion', 'netherite-pot', 'neth-pot'],
    dpot: ['dpot', 'diamond-potion', 'diamond-pot', 'dia-pot'],
    uhc: ['uhc', 'uhc-waitlist'],
    smp: ['smp', 'smp-waitlist'],
    crystal: ['crystal', 'crystal-waitlist', 'cpvp'],
    mace: ['mace', 'mace-waitlist'],
  };

  if (!channel) {
    const searchKeywords = modeAliases[mode] || [mode];
    channel = guild.channels.cache.find(c =>
      c.isTextBased() && searchKeywords.some(keyword => c.name.toLowerCase().includes(keyword))
    ) as TextChannel | undefined;

    if (channel && guildConfig) {
      channelIds.waitlists = channelIds.waitlists || {};
      channelIds.waitlists[mode] = channel.id;
      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { channelIds },
      });
    }
  }

  if (!channel) return;

  // Find waitlist role
  let waitlistRoleId = roleIds?.waitlists?.[mode];
  let waitlistRole = waitlistRoleId ? guild.roles.cache.get(waitlistRoleId) : null;

  if (!waitlistRole) {
    const searchKeywords = modeAliases[mode] || [mode];
    waitlistRole = guild.roles.cache.find(r =>
      searchKeywords.some(kw => r.name.toLowerCase().includes(kw)) &&
      (r.name.toLowerCase().includes('waitlist') || r.name.toLowerCase().includes('queue') || r.name.toLowerCase().includes('ping'))
    ) || guild.roles.cache.find(r => searchKeywords.some(kw => r.name.toLowerCase().includes(kw))) || null;

    if (waitlistRole && guildConfig) {
      roleIds.waitlists = roleIds.waitlists || {};
      roleIds.waitlists[mode] = waitlistRole.id;
      await prisma.guildConfig.update({
        where: { guildId: guild.id },
        data: { roleIds },
      });
    }
  }

  // Update waitlist panel so button turns green immediately
  await sendOrUpdateWaitlistPanel(guild, mode);

  const rolePing = waitlistRole ? `<@&${waitlistRole.id}>` : '';

  const msg = await channel.send({
    content: `${rolePing ? `${rolePing} ` : ''}🟢 **Testing is now OPEN!** <@${testerDiscordId}> is actively testing **${MODES[mode]}**! Join the queue now!`,
    allowedMentions: waitlistRole ? { roles: [waitlistRole.id], users: [testerDiscordId] } : { parse: ['everyone', 'roles', 'users'] },
  });

  await setPanelMsgId(guild.id, ['openPings', mode], msg.id);
}

// ─── Notify when testing closes ─────────────────────────────────────────────────
export async function pingTestingClosed(
  guild: Guild,
  mode: Mode,
  reason: string = 'Queue closed by tester'
): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  const channelIds = (guildConfig?.channelIds as Record<string, any>) || {};
  let waitlistChannelId = channelIds?.waitlists?.[mode];

  let channel: TextChannel | undefined;
  if (waitlistChannelId) {
    channel = (guild.channels.cache.get(waitlistChannelId) || await guild.channels.fetch(waitlistChannelId).catch(() => null)) as TextChannel | undefined;
  }

  if (channel) {
    const panelMessageIds = (guildConfig?.panelMessageIds as Record<string, any>) || {};
    const openPingId = panelMessageIds?.openPings?.[mode];
    if (openPingId) {
      try {
        const pingMsg = await channel.messages.fetch(openPingId);
        await pingMsg.delete();
      } catch {}
      await setPanelMsgId(guild.id, ['openPings', mode], null);
    }
  }

  // Refresh waitlist panel to show closed state
  await sendOrUpdateWaitlistPanel(guild, mode);
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
        .setTitle('🛠️ Arix Server Support')
        .setDescription(
          `Need assistance from the Arix Support Team?\n\n` +
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
          `Want to join the Arix Tierlist Staff Team as an official **Tier Tester**?\n\n` +
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
