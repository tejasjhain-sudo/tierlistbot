import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { sendOrUpdateVerificationAuthPanel } from '../../services/panelService';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('send-verify-panel')
    .setDescription('[Admin] Send or update the Server Verification Panel embed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Channel to send verification panel to (defaults to current channel)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel = (interaction.options.getChannel('channel') as TextChannel) || (interaction.channel as TextChannel);

    // Save this channel as the verification channel in GuildConfig
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const channelIds = (guildConfig?.channelIds as Record<string, any>) ?? {};
    channelIds.verifyChannel = targetChannel.id;

    await prisma.guildConfig.upsert({
      where: { guildId: interaction.guild.id },
      update: { channelIds },
      create: {
        guildId: interaction.guild.id,
        channelIds,
      },
    });

    await sendOrUpdateVerificationAuthPanel(interaction.guild);

    return interaction.editReply({ content: `✅ Verification Panel deployed in <#${targetChannel.id}>!` });
  },
};
