import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  PermissionFlagsBits,
} from 'discord.js';
import { sendSupportPanel } from '../../services/supportTicketService';

export default {
  data: new SlashCommandBuilder()
    .setName('send-support-panel')
    .setDescription('[Staff] Send the Support Ticket Panel embed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to send panel to (defaults to current channel)').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const targetChannel = (interaction.options.getChannel('channel') as TextChannel) || (interaction.channel as TextChannel);

    await sendSupportPanel(interaction.guild, targetChannel);
    return interaction.editReply({ content: `✅ Support Ticket Panel sent in ${targetChannel}!` });
  },
};
