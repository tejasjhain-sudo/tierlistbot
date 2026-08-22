import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('send-high-panel')
    .setDescription('[Staff] Send the High Tier Testing Panel embed.')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to send panel to (defaults to current channel)').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    // Permission check
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);

    if (!isAdmin) {
      return interaction.reply({ content: '❌ Only Tier Admins and Administrators can send the High Tier Panel.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel = (interaction.options.getChannel('channel') as TextChannel) || (interaction.channel as TextChannel);

    const embed = new EmbedBuilder()
      .setTitle('🔥 High Tier Evaluation Testing')
      .setDescription(
        `High Tier Evaluation Testing is reserved for players who have achieved **LT3 or higher** in any gamemode.\n\n` +
        `• **Requirements:** Minimum rank of \`LT3\`, \`HT3\`, \`LT2\`, \`HT2\`, \`LT1\`, or \`HT1\`.\n` +
        `• **Process:** Click below to select your gamemode and open a dedicated High Tier Ticket.\n\n` +
        `🛑 *Failure to meet rank requirements will deny your ticket.*`
      )
      .setColor(COLORS.RESULT)
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('open_high_ticket_prompt')
        .setLabel('🔥 Open High Tier Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    try {
      const recent = await targetChannel.messages.fetch({ limit: 15 });
      const botMessages = Array.from(recent.values()).filter(m => m.author.id === interaction.client.user?.id);
      for (const bMsg of botMessages) {
        try { await bMsg.delete(); } catch {}
      }
    } catch {}

    await targetChannel.send({ embeds: [embed], components: [row] });

    return interaction.editReply({ content: `✅ High Tier Testing Panel sent in ${targetChannel}!` });
  },
};
