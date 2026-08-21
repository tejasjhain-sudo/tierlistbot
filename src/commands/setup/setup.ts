import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { runSetup } from '../../services/setupService';
import { sendOrUpdateRegistrationPanel, sendOrUpdateAllWaitlistPanels } from '../../services/panelService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up RearMC Tier Testing channels, roles, and panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const logs = await runSetup(interaction.guild);

      // Send panels
      await sendOrUpdateRegistrationPanel(interaction.guild);
      await sendOrUpdateAllWaitlistPanels(interaction.guild);

      const embed = new EmbedBuilder()
        .setTitle('✅ RearMC Setup Complete')
        .setDescription('All channels, roles, and panels have been created or verified.')
        .addFields({ name: '📋 Setup Log', value: `\`\`\`\n${logs.slice(0, 1000)}\n\`\`\`` })
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Setup failed:', error);
      await interaction.editReply({ content: '❌ Setup failed. Check bot permissions and try again.' });
    }
  },
};
