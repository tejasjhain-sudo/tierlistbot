import {
  GuildMember,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { config } from '../config';
import { COLORS } from '../config/constants';

export function getBackupAuthUrl(): string {
  const redirectUri = `${config.publicApiUrl}/api/auth/callback`;
  return `https://discord.com/api/oauth2/authorize?client_id=${config.discordClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds.join`;
}

/**
 * Sends a welcome & onboarding DM to a new member joining the server
 */
export async function sendMemberOnboarding(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  try {
    const authUrl = getBackupAuthUrl();

    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`⚔️ Welcome to ${member.guild.name}!`)
      .setDescription(
        `Hey <@${member.id}>, welcome to the official **${member.guild.name}**!\n\n` +
        `### 🚀 **Quick Setup & Onboarding:**\n` +
        `1️⃣ **Get Verified & Registered**: Go to <#${member.guild.channels.cache.find(c => c.name.includes('request-test'))?.id || 'register'}> to link your Minecraft account and unlock queue access.\n` +
        `2️⃣ **Notification Preferences**: Pick which pings you would like to receive below so you never miss testing queues, announcements, or events.\n` +
        `3️⃣ **Authorize Server Backup & Auto-Join**: Click **Authorize Backup** below. This protects your account and allows the bot to automatically restore your tiers and re-add you if our server ever migrates!`
      )
      .setColor(COLORS.PRIMARY)
      .setThumbnail(member.guild.iconURL() || member.user.displayAvatarURL())
      .setFooter({ text: 'RearMC Automated Onboarding System' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('🔒 Authorize Backup & Auto-Join')
        .setStyle(ButtonStyle.Link)
        .setURL(authUrl),
      new ButtonBuilder()
        .setCustomId('onboarding_ping_roles_prompt')
        .setLabel('🔔 Choose Notification Pings')
        .setStyle(ButtonStyle.Success),
    );

    await member.send({
      embeds: [welcomeEmbed],
      components: [row],
    });

    console.log(`[Onboarding] Sent welcome & backup onboarding DM to ${member.user.tag} (${member.id})`);
  } catch (err) {
    // DMs might be closed for the user
    console.log(`[Onboarding] Could not send DM to ${member.user.tag} (DMs closed or blocked)`);
  }
}
