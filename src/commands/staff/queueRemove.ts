import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Mode } from '../../config/constants';
import { staffRemoveFromQueue } from '../../services/queueService';
import { sendOrUpdateWaitlistPanel } from '../../services/panelService';
import { COLORS, MODES } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('queue-remove')
    .setDescription('Remove a player from a specific waitlist queue.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(opt => 
      opt.setName('player').setDescription('The player to remove').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('mode').setDescription('The mode queue to remove them from').setRequired(true)
        .addChoices(
          { name: 'Sword', value: 'sword' },
          { name: 'Axe', value: 'axe' },
          { name: 'Netherite Pot', value: 'nethpot' },
          { name: 'Diamond Pot', value: 'dpot' },
          { name: 'UHC', value: 'uhc' },
          { name: 'SMP', value: 'smp' },
          { name: 'Crystal', value: 'crystal' },
          { name: 'Mace', value: 'mace' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('player', true);
    const mode = interaction.options.getString('mode', true) as Mode;

    const result = await staffRemoveFromQueue(interaction.guild.id, targetUser.id, mode, interaction.user.id);

    if (result.success) {
      await sendOrUpdateWaitlistPanel(interaction.guild, mode);
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Player Removed')
        .setDescription(`Successfully removed <@${targetUser.id}> from the **${MODES[mode]}** queue.`)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();
        
      return interaction.editReply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setTitle('❌ Could Not Remove')
        .setDescription(result.message)
        .setColor(COLORS.DANGER);
        
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
