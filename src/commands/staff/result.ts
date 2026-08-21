import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('Configure result and log channels for tier testing.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommandGroup(group =>
      group
        .setName('channel')
        .setDescription('Manage the results channel.')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Set the channel where tier test results are posted.')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Text channel to post results in.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('logchannel')
        .setDescription('Manage the log channel.')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Set the channel where bot logs and audit events are posted.')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Text channel to post logs in.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const group = interaction.options.getSubcommandGroup(true);
    const sub = interaction.options.getSubcommand(true);
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const channelIds: Record<string, string> = (guildConfig?.channelIds as Record<string, string>) ?? {};

    if (group === 'channel' && sub === 'add') {
      channelIds.updates = channel.id;

      await prisma.guildConfig.upsert({
        where: { guildId: interaction.guild.id },
        update: { channelIds },
        create: {
          guildId: interaction.guild.id,
          channelIds,
          roleIds: {},
          categoryIds: {},
          panelMessageIds: {},
          settings: {},
        },
      });

      // Post initial Results channel header embed
      const headerEmbed = new EmbedBuilder()
        .setTitle('🏆 Tier Test Results')
        .setDescription('All completed evaluation testing results and rank updates will be officially posted in this channel.')
        .setColor(COLORS.PRIMARY)
        .setTimestamp();

      try {
        await channel.send({ embeds: [headerEmbed] });
      } catch (err) {
        console.warn('Could not post header embed to results channel:', err);
      }

      return interaction.editReply({
        content: `✅ **Results channel** set to <#${channel.id}>. An initial header panel was sent to the channel. You can also run \`/add results\` or \`/sync-results\` to copy past test results into it!`,
      });
    }

    if (group === 'logchannel' && sub === 'add') {
      channelIds.botLogs = channel.id;

      await prisma.guildConfig.upsert({
        where: { guildId: interaction.guild.id },
        update: { channelIds },
        create: {
          guildId: interaction.guild.id,
          channelIds,
          roleIds: {},
          categoryIds: {},
          panelMessageIds: {},
          settings: {},
        },
      });

      return interaction.editReply({
        content: `✅ **Log channel** set to <#${channel.id}>. Bot logs and audit events will now be posted there.`,
      });
    }

    return interaction.editReply({ content: '❌ Unknown subcommand.' });
  },
};
