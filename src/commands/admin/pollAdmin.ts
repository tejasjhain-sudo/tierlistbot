import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('poll-admin')
    .setDescription('Manage the Poll of the Day settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => 
      sub.setName('set-channel')
      .setDescription('Set the channel where Poll of the Day will be posted')
      .addChannelOption(opt => opt.setName('channel').setDescription('The channel').setRequired(true))
    )
    .addSubcommand(sub => 
      sub.setName('set-limit')
      .setDescription('Set the maximum number of polls allowed per day')
      .addIntegerOption(opt => opt.setName('limit').setDescription('Max polls per day').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset-limit')
      .setDescription('Reset the daily poll limit so 3 more polls can be created today')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });
    
    await interaction.deferReply({ ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    if (!guildConfig) return interaction.editReply({ content: 'Server not configured.' });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set-channel') {
      const channel = interaction.options.getChannel('channel', true);
      const channelIds = (guildConfig.channelIds as Record<string, string>) || {};
      channelIds.pollOfTheDay = channel.id;

      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { channelIds },
      });

      return interaction.editReply({ content: `✅ Poll of the Day channel set to <#${channel.id}>.` });
    }

    if (subcommand === 'set-limit') {
      const limit = interaction.options.getInteger('limit', true);
      const settings = (guildConfig.settings as Record<string, any>) || {};
      settings.pollLimit = limit;

      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { settings },
      });

      return interaction.editReply({ content: `✅ Maximum daily polls updated to **${limit}**.` });
    }

    if (subcommand === 'reset-limit') {
      const settings = (guildConfig.settings as Record<string, any>) || {};
      if (settings.dailyPolls) {
        settings.dailyPolls.count = 0;
        settings.dailyPolls.users = [];
      } else {
        settings.dailyPolls = { date: new Date().toISOString().split('T')[0], count: 0, users: [] };
      }

      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { settings },
      });

      return interaction.editReply({ content: `✅ Daily poll limit has been reset! Users can now create 3 more polls today.` });
    }
  }
};
