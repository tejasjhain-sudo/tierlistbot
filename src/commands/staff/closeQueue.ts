import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { stopTesting } from '../../services/testerService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('close-queue')
    .setDescription('Stop testing session and close the current waitlist queue.'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const result = await stopTesting(interaction.guild, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle(result.success ? '🔒 Queue Closed' : '❌ Error')
      .setDescription(result.message)
      .setColor(result.success ? COLORS.WARNING : COLORS.DANGER)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
