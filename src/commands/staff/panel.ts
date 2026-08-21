import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { sendOrUpdateRegistrationPanel, sendOrUpdateAllWaitlistPanels } from '../../services/panelService';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Manage the tier testing waitlist panels.')
    .addSubcommand(sub =>
      sub
        .setName('send')
        .setDescription('Send the Request Test / Registration panel to a specific channel.')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to send the panel into (default: current channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand(sub => sub.setName('refresh').setDescription('Refresh all panels (registration + waitlists).'))
    .addSubcommand(sub => sub.setName('resend').setDescription('Force resend a brand new registration panel message.')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    let member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null) ?? undefined;
    }

    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? (member?.roles.cache.has(roleIds.tierManager) ?? false) : false);

    if (!isStaff) {
      return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'send') {
      const channelOption = interaction.options.getChannel('channel') as TextChannel | null;
      const targetChannel = channelOption || (interaction.channel as TextChannel);

      if (!targetChannel || !targetChannel.isTextBased()) {
        return interaction.editReply({ content: '❌ Invalid text channel selected.' });
      }

      const channelIds = (guildConfig?.channelIds as Record<string, string>) ?? {};
      channelIds.register = targetChannel.id;

      const panelMessageIds = (guildConfig?.panelMessageIds as Record<string, string>) ?? {};
      delete panelMessageIds.register;

      await prisma.guildConfig.upsert({
        where: { guildId: interaction.guild.id },
        update: { channelIds, panelMessageIds },
        create: {
          guildId: interaction.guild.id,
          channelIds,
          panelMessageIds,
          roleIds: {},
          categoryIds: {},
          settings: {},
        },
      });

      await sendOrUpdateRegistrationPanel(interaction.guild);

      const embed = new EmbedBuilder()
        .setTitle('✅ Request Test Panel Sent!')
        .setDescription(`The **Request Test / Registration** panel has been posted to <#${targetChannel.id}>.`)
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'resend') {
      // Clear current panelMessageIds.register so a brand new message is sent
      const panelMessageIds = (guildConfig?.panelMessageIds as Record<string, any>) ?? {};
      delete panelMessageIds.register;
      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { panelMessageIds },
      });
      await sendOrUpdateRegistrationPanel(interaction.guild);

      const embed = new EmbedBuilder()
        .setTitle('✅ Panel Resent')
        .setDescription('A brand new Registration/Request Test panel has been posted to the configured channel.')
        .setColor(COLORS.SUCCESS)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // Default: refresh
    await sendOrUpdateRegistrationPanel(interaction.guild);
    await sendOrUpdateAllWaitlistPanels(interaction.guild);

    const embed = new EmbedBuilder()
      .setTitle('✅ Panels Refreshed')
      .setDescription('Registration and all waitlist panels have been updated.')
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
