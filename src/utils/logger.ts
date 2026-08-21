import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import prisma from '../database/prisma';

export async function logToChannel(client: Client, guildId: string, embed: EmbedBuilder): Promise<void> {
  try {
    const config = await prisma.guildConfig.findUnique({ where: { guildId } });
    if (!config) return;

    const channelIds = config.channelIds as any;
    if (!channelIds?.botLogs) return;

    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const logChannel = guild.channels.cache.get(channelIds.botLogs) as TextChannel || await guild.channels.fetch(channelIds.botLogs).catch(() => null);
    if (!logChannel || !logChannel.isTextBased()) return;

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to send log to channel:', error);
  }
}
