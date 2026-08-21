import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a player for unfair advantages, or configure the reports channel.')
    .addSubcommand(sub =>
      sub.setName('player')
        .setDescription('Report a player to the staff team.')
        .addUserOption(opt =>
          opt.setName('player')
            .setDescription('The player to report')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('reason')
            .setDescription('Reason for the report (e.g. Autoclicker, macros)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('evidence')
            .setDescription('Link to video or screenshot evidence')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('channel')
        .setDescription('Configure the channel where reports are sent (Admins only).')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('The channel to send reports to')
            .addChannelTypes(0) // Text channel
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const member = interaction.guild.members.cache.get(interaction.user.id);

    if (sub === 'channel') {
      if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply('❌ Only Administrators can configure the report channel.');
      }

      const channel = interaction.options.getChannel('channel', true);
      const channelIds = (guildConfig?.channelIds as Record<string, any>) ?? {};
      channelIds.reports = channel.id;

      await prisma.guildConfig.upsert({
        where: { guildId: interaction.guild.id },
        update: { channelIds: channelIds as any },
        create: { guildId: interaction.guild.id, categoryIds: {}, channelIds: channelIds as any, roleIds: {}, panelMessageIds: {}, settings: {} },
      });

      return interaction.editReply(`✅ Reports will now be sent to <#${channel.id}>.`);
    }

    if (sub === 'player') {
      const targetUser = interaction.options.getUser('player', true);
      const reason = interaction.options.getString('reason', true);
      const evidence = interaction.options.getString('evidence');

      const channelIds = (guildConfig?.channelIds as Record<string, any>) ?? {};
      const reportsChannelId = channelIds.reports;

      if (!reportsChannelId) {
        return interaction.editReply('❌ The reports channel has not been configured. An Administrator must use `/report channel` first.');
      }

      const reportsChannel = interaction.guild.channels.cache.get(reportsChannelId) as TextChannel | undefined;
      if (!reportsChannel) {
        return interaction.editReply('❌ The configured reports channel no longer exists. Please ask an Administrator to reconfigure it.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🚨 New Player Report')
        .addFields(
          { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reported Player', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Reason', value: reason, inline: false },
        )
        .setColor(COLORS.DANGER)
        .setTimestamp();

      if (evidence) {
        embed.addFields({ name: 'Evidence', value: evidence, inline: false });
      }

      try {
        await reportsChannel.send({ content: `<@${targetUser.id}>`, embeds: [embed] });
        await interaction.editReply('✅ Your report has been submitted successfully to the staff team.');
      } catch (error) {
        console.error('Failed to send report:', error);
        await interaction.editReply('❌ Failed to send the report. Ensure the bot has permissions to post in the configured reports channel.');
      }
    }
  },
};
