import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('backup-stats')
    .setDescription('[Admin] View how many players have authorized the OAuth backup system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const totalPlayers = await prisma.player.count();
      const oauthPlayers = await prisma.player.findMany({
        where: {
          discordAccessToken: { not: null },
        },
        select: {
          discordId: true,
          minecraftUsername: true,
          region: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      const recentList = oauthPlayers.slice(0, 15).map((p, i) => {
        return `\`${i + 1}.\` <@${p.discordId}> (**${p.minecraftUsername || 'Unknown'}**) • \`${p.region}\``;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🔒 OAuth2 Backup & Migration Status')
        .setDescription(
          `### 📊 **Summary Statistics:**\n` +
          `• **Total Database Players**: \`${totalPlayers}\`\n` +
          `• **OAuth Backup Authorized**: \`${oauthPlayers.length}\` players (\`${Math.round((oauthPlayers.length / (totalPlayers || 1)) * 100)}%\`)\n\n` +
          `### 🛡️ **Recent Authorizations:**\n` +
          (recentList || '*No players authorized yet.*') +
          (oauthPlayers.length > 15 ? `\n\n*... and ${oauthPlayers.length - 15} more players.*` : '')
        )
        .setColor(COLORS.PRIMARY)
        .setFooter({ text: 'Use /transfer-players to migrate authorized users to a new server' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (e: any) {
      console.error('Error fetching backup stats:', e);
      return interaction.editReply({ content: `❌ Error checking backup statistics: ${e.message}` });
    }
  },
};
