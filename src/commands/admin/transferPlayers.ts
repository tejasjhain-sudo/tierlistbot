import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('transfer-players')
    .setDescription('Forcefully join all backed-up players into this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const playersWithTokens = await prisma.player.findMany({
      where: {
        discordAccessToken: { not: null },
      },
    });

    if (playersWithTokens.length === 0) {
      return interaction.editReply('❌ No players have authorized the backup system yet.');
    }

    let successCount = 0;
    let failCount = 0;

    const embed = new EmbedBuilder()
      .setTitle('🔄 Transferring Players...')
      .setDescription(`Found **${playersWithTokens.length}** backed-up players. Starting transfer process...`)
      .setColor(COLORS.PRIMARY);

    await interaction.editReply({ embeds: [embed] });

    for (const player of playersWithTokens) {
      try {
        const response = await fetch(`https://discord.com/api/guilds/${interaction.guild.id}/members/${player.discordId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bot ${config.discordToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            access_token: player.discordAccessToken,
          }),
        });

        if (response.ok || response.status === 204 || response.status === 201) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
      
      // Sleep a bit to avoid hitting rate limits instantly
      await new Promise(r => setTimeout(r, 200));
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Transfer Complete')
      .setDescription(`Successfully pulled **${successCount}** players into the server.\nFailed to pull **${failCount}** players (they may have revoked access or the token expired).`)
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] });
  },
};
