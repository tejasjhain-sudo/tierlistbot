import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  PermissionFlagsBits,
} from 'discord.js';
import { sendTesterApplicationPanel } from '../../services/testerApplicationService';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('send-tester-app')
    .setDescription('[Staff] Send the Tester Application Panel embed.')
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

    await sendTesterApplicationPanel(interaction.guild, targetChannel);
    return interaction.editReply({ content: `✅ Tester Application Panel sent in ${targetChannel}!` });
  },
};
