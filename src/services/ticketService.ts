import {
  Guild,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  OverwriteType,
  ChannelType,
} from 'discord.js';
import { Mode, Region, Tier, SessionStatus } from '../config/constants';
import prisma from '../database/prisma';
import { COLORS, MODES, REGIONS } from '../config/constants';
import { getPlayerHeadUrl } from './minecraftService';
import { setTicketPermissions } from './roleService';

// ─── Build ticket embed ───────────────────────────────────────────────────────
export function buildTicketEmbed(params: {
  playerDiscordId: string;
  minecraftUsername: string;
  testerDiscordId: string;
  mode: Mode;
  region: Region;
  previousTier: Tier | null;
  waitMinutes: number;
  sessionId?: string;
  id?: string;
  testerAvatarUrl?: string;
  testerDisplayName?: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({
      name: `Tier Test Session — Tester: ${params.testerDisplayName ?? `<@${params.testerDiscordId}>`}`,
      iconURL: params.testerAvatarUrl ?? undefined,
    })
    .setThumbnail(getPlayerHeadUrl(params.minecraftUsername))
    .addFields(
      { name: 'Player', value: `<@${params.playerDiscordId}>`, inline: true },
      { name: 'Minecraft Username', value: `**${params.minecraftUsername}**`, inline: true },
      { name: 'Tester', value: `<@${params.testerDiscordId}>`, inline: true },
      { name: 'Mode', value: `**${MODES[params.mode]}**`, inline: true },
      { name: 'Region', value: `\`${params.region}\``, inline: true },
      { name: 'Previous Tier', value: params.previousTier ?? 'Unranked', inline: true },
      { name: 'Queue Wait Time', value: `\`${params.waitMinutes}m\``, inline: true },
      { name: 'Session ID', value: `\`${params.sessionId ?? params.id}\``, inline: true },
    )
    .setColor(0x2b2d31)
    .setFooter({ text: 'RearMC Tier Testing' })
    .setTimestamp();
}

// ─── Build ticket action buttons ─────────────────────────────────────────────
export function buildTicketButtons(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`complete_test_${sessionId}`).setLabel('Complete Test').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`skip_player_${sessionId}`).setLabel('Skip Player').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cancel_session_${sessionId}`).setLabel('Cancel Session').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`close_ticket_${sessionId}`).setLabel('Close Ticket').setStyle(ButtonStyle.Primary),
  );
}

// ─── Create a testing ticket ──────────────────────────────────────────────────
export async function createTestTicket(
  guild: Guild,
  session: {
    id: string;
    playerDiscordId: string;
    minecraftUsername: string;
    testerDiscordId: string;
    mode: Mode;
    region: Region;
    previousTier: Tier | null;
    waitMinutes: number;
  }
): Promise<TextChannel | null> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  if (!guildConfig) {
    throw new Error(`No guildConfig found for guild ${guild.id}`);
  }

  // Use mode-specific category from DB config, fall back to generic tickets category
  const categoryIds = guildConfig.categoryIds as Record<string, any>;
  const ticketsCategoryId = categoryIds?.tickets?.[session.mode] ?? categoryIds?.tickets ?? null;

  if (!ticketsCategoryId) {
    throw new Error(`No ticket category configured for mode "${session.mode}". Use /setup to configure categories.`);
  }

  const channelName = `test-${session.mode}-${session.minecraftUsername.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: ticketsCategoryId,
      reason: `Tier test ticket for ${session.minecraftUsername}`,
    }) as TextChannel;
  } catch (error: any) {
    throw new Error(`Discord API Error: ${error.message}`);
  }

  await setTicketPermissions(channel, session.playerDiscordId, session.testerDiscordId);

  // Fetch tester's Discord avatar for the embed
  let testerAvatarUrl: string | undefined;
  let testerDisplayName: string | undefined;
  try {
    const testerMember = await guild.members.fetch(session.testerDiscordId);
    testerAvatarUrl = testerMember.user.displayAvatarURL({ size: 64 });
    testerDisplayName = testerMember.displayName;
  } catch {}

  const embed = buildTicketEmbed({ ...session, testerAvatarUrl, testerDisplayName });
  const row = buildTicketButtons(session.id);

  await channel.send({
    content: `<@${session.playerDiscordId}> <@${session.testerDiscordId}> — Your tier test has started!`,
    embeds: [embed],
    components: [row],
  });

  return channel;
}



// ─── Build result embed for #tier-updates ────────────────────────────────────
export function buildResultEmbed(params: {
  minecraftUsername: string;
  minecraftUuid: string | null;
  testerDiscordId: string;
  mode: Mode;
  region: Region;
  previousTier: Tier | null;
  earnedTier: Tier;
  earnedTierRoleId?: string;
  sessionId: string;
  notes?: string;
  evidenceUrl?: string;
}): EmbedBuilder {
  const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(params.minecraftUuid ?? params.minecraftUsername)}/64`;
  const bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(params.minecraftUuid ?? params.minecraftUsername)}/128`;

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${params.minecraftUsername}'s Tier Update 🏆`, iconURL: avatarUrl })
    .setThumbnail(bodyUrl)
    .addFields(
      { name: 'Tester', value: `<@${params.testerDiscordId}>`, inline: false },
      { name: 'Role', value: params.earnedTierRoleId ? `<@&${params.earnedTierRoleId}>` : `\`${params.earnedTier}\``, inline: false },
      { name: 'Minecraft Username', value: params.minecraftUsername, inline: false },
      { name: 'Gamemode', value: MODES[params.mode], inline: false },
      { name: 'Previous Rank', value: params.previousTier ?? 'Unranked', inline: false },
      { name: 'Earned Rank', value: params.earnedTier, inline: false },
      { name: 'Region', value: params.region, inline: false },
    )
    .setColor(0xF5C518) // Gold/yellow line on the left
    .setTimestamp();

  if (params.notes) embed.addFields({ name: 'Notes', value: params.notes });
  if (params.evidenceUrl) embed.addFields({ name: 'Evidence', value: params.evidenceUrl });

  return embed;
}

// ─── Build history embed line ─────────────────────────────────────────────────
export function buildHistoryEmbed(params: {
  minecraftUsername: string;
  testerDiscordId: string;
  mode: Mode;
  region: Region;
  previousTier: Tier | null;
  earnedTier: Tier;
  sessionId: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`📜 Test Log — ${params.minecraftUsername}`)
    .addFields(
      { name: 'Mode', value: MODES[params.mode], inline: true },
      { name: 'Region', value: `\`${params.region}\``, inline: true },
      { name: 'Tester', value: `<@${params.testerDiscordId}>`, inline: true },
      { name: 'Previous', value: params.previousTier ?? '`Unranked`', inline: true },
      { name: 'Result', value: `\`${params.earnedTier}\``, inline: true },
      { name: 'Session', value: `\`${params.sessionId}\``, inline: true },
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();
}
