import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { pullNextPlayer } from '../../services/testerService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('next')
    .setDescription('Pull the next player from your active queue.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });

    const result = await pullNextPlayer(interaction.guild, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle(result.success ? '✅ Next Player Pulled' : '❌ Could Not Pull Player')
      .setDescription(result.message)
      .setColor(result.success ? COLORS.SUCCESS : COLORS.DANGER)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
