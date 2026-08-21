import { Guild, TextChannel, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Mode, Tier } from '../config/constants';
import prisma from '../database/prisma';
import { MODES, TIER_ORDER, COLORS } from '../config/constants';
import { setTicketPermissions } from './roleService';

// ─── High Tier Ticket Qualification Check ──────────────────────────────────────
export function qualifiesForHighTicket(currentTier: Tier | null | undefined): boolean {
  if (!currentTier || currentTier === 'Unranked') return false;
  const order = TIER_ORDER[currentTier];
  return order !== undefined && order <= 10; // LT5 or higher (HT1=1 to LT5=10)
}

// ─── Create High Tier Ticket ───────────────────────────────────────────────────
export async function createHighTierTicket(
  guild: Guild,
  playerDiscordId: string,
  mode: Mode
): Promise<{ success: boolean; message: string; channelId?: string }> {

  const player = await prisma.player.findUnique({ where: { discordId: playerDiscordId } });
  if (!player || !player.minecraftUuid) {
    return { success: false, message: '❌ You must verify your Minecraft account before opening a High Tier Test ticket.' };
  }

  // Fetch current tier for mode
  const playerTier = await prisma.playerTier.findUnique({
    where: { playerId_mode: { playerId: player.id, mode } },
  });
  const currentTier = (playerTier?.currentTier as Tier | null) ?? 'Unranked';

  if (!qualifiesForHighTicket(currentTier)) {
    return {
      success: false,
      message: `❌ High Tier Tests require a minimum tier of **LT3** or higher.\nYour current rank in **${MODES[mode]}** is \`${currentTier}\`.`,
    };
  }

  // Fetch guild config for HIGH TICKETS category
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  const categoryIds = (guildConfig?.categoryIds as Record<string, any>) ?? {};
  
  let highCategory = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && (c.id === categoryIds.highTickets || c.name.toUpperCase().includes('HIGH TICKET'))
  ) as any;

  if (!highCategory) {
    highCategory = await guild.channels.create({
      name: '🔥 HIGH TICKETS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });

    categoryIds.highTickets = highCategory.id;
    await prisma.guildConfig.update({
      where: { guildId: guild.id },
      data: { categoryIds: categoryIds as any },
    });
  }

  const channelName = `high-${MODES[mode].toLowerCase()}-${player.minecraftUsername.toLowerCase()}`;

  // Check if player already has an open high ticket in this mode
  const existingChannel = guild.channels.cache.find(
    c => c.name === channelName && c.parentId === highCategory.id
  );
  if (existingChannel) {
    return { success: false, message: `⚠️ You already have an open High Tier ticket: <#${existingChannel.id}>` };
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: highCategory.id,
  });

  await setTicketPermissions(channel, playerDiscordId, guild.ownerId);

  const embed = new EmbedBuilder()
    .setTitle(`🔥 High Tier Test Ticket — ${MODES[mode]}`)
    .setDescription(
      `Welcome <@${playerDiscordId}>!\n\n` +
      `🎮 **Minecraft IGN:** \`${player.minecraftUsername}\`\n` +
      `🆔 **Minecraft UUID:** \`${player.minecraftUuid}\`\n` +
      `🏆 **Current Tier:** \`${currentTier}\` (Qualified for High Test)\n` +
      `🌍 **Region:** \`${player.region}\`\n\n` +
      `A High Tier Tester will be assigned to conduct your high tier evaluation shortly.`
    )
    .setColor(COLORS.RESULT)
    .setTimestamp();

  const closeBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_high_${playerDiscordId}`)
      .setLabel('Close High Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${playerDiscordId}>`, embeds: [embed], components: [closeBtn] });

  return {
    success: true,
    message: `✅ Created High Tier Test ticket in <#${channel.id}>!`,
    channelId: channel.id,
  };
}
