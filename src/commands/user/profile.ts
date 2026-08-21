import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS, MODES, Mode } from '../../config/constants';
import { getPlayerHeadUrl } from '../../services/minecraftService';

export default {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a player\'s RearmC Tier List profile.')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('User to view profile for (default: yourself)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: false });

    const targetUser = interaction.options.getUser('user') || interaction.user;

    try {
      const player = await prisma.player.findUnique({
        where: { discordId: targetUser.id },
        include: {
          tiers: true,
          tierHistory: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!player) {
        const embed = new EmbedBuilder()
          .setTitle('❓ Profile Not Found')
          .setDescription(
            `<@${targetUser.id}> has not verified their Minecraft account yet.\n\n` +
            `Use **/verify** or click **Verify Account** in the testing panel to link your account!`
          )
          .setColor(COLORS.WARNING);
        return interaction.editReply({ embeds: [embed] });
      }

      // Calculate best tier & total tests
      const totalTests = player.tierHistory.length;
      const lastTest = player.tierHistory[0];

      let tierSummary = '';
      if (player.tiers.length > 0) {
        tierSummary = player.tiers.map(t => `• **${MODES[t.mode as Mode] || t.mode}:** \`${t.currentTier}\``).join('\n');
      } else {
        tierSummary = '_No tier test ranks recorded yet._';
      }

      const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(player.minecraftUuid ?? player.minecraftUsername)}/64`;
      const bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(player.minecraftUuid ?? player.minecraftUsername)}/128`;

      const embed = new EmbedBuilder()
        .setTitle(`🎮 RearmC Player Profile — ${player.minecraftUsername}`)
        .setThumbnail(avatarUrl)
        .addFields(
          { name: 'Minecraft IGN', value: `\`${player.minecraftUsername}\``, inline: true },
          { name: 'Discord', value: `<@${player.discordId}>`, inline: true },
          { name: 'Verification', value: '✅ **Verified**', inline: true },
          { name: 'Region', value: `\`${player.region}\``, inline: true },
          { name: 'Preferred Mode', value: MODES[player.preferredMode as Mode] || player.preferredMode, inline: true },
          { name: 'Total Tests Completed', value: `\`${totalTests}\``, inline: true },
          { name: '🏆 Current Tiers', value: tierSummary, inline: false },
          ...(lastTest ? [{
            name: '⏱️ Last Test Result',
            value: `Mode: **${MODES[lastTest.mode as Mode] || lastTest.mode}** | Rank: \`${lastTest.earnedTier}\` | <t:${Math.floor(lastTest.createdAt.getTime() / 1000)}:R>`,
            inline: false,
          }] : []),
        )
        .setColor(COLORS.PRIMARY)
        .setFooter({ text: `UUID: ${player.minecraftUuid ?? 'N/A'}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error fetching profile:', error);
      const embed = new EmbedBuilder()
        .setDescription('❌ Failed to retrieve player profile.')
        .setColor(COLORS.DANGER);
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
