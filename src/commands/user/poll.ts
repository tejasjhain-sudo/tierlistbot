import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a Poll of the Day! Limited to 3 per day server-wide.')
    .addStringOption(opt => opt.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption(opt => opt.setName('option1').setDescription('First option').setRequired(true))
    .addStringOption(opt => opt.setName('option2').setDescription('Second option').setRequired(true))
    .addStringOption(opt => opt.setName('option3').setDescription('Third option (optional)').setRequired(false))
    .addStringOption(opt => opt.setName('option4').setDescription('Fourth option (optional)').setRequired(false))
    .addStringOption(opt => opt.setName('option5').setDescription('Fifth option (optional)').setRequired(false))
    .addIntegerOption(opt => 
      opt.setName('duration')
      .setDescription('Poll duration in hours (default: 24)')
      .setRequired(false)
      .addChoices(
        { name: '1 Hour', value: 1 },
        { name: '4 Hours', value: 4 },
        { name: '24 Hours', value: 24 },
        { name: '3 Days', value: 72 },
        { name: '1 Week', value: 168 }
      )
    )
    .addBooleanOption(opt => opt.setName('multiselect').setDescription('Allow users to pick multiple answers?').setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    // 1. Get database config for daily limits and channel
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    if (!guildConfig) return interaction.reply({ content: 'Server not configured.', ephemeral: true });

    const settings = (guildConfig.settings as Record<string, any>) || {};
    const dailyPolls = settings.dailyPolls || { date: '', count: 0, users: [] };
    const pollLimit = settings.pollLimit || 3;
    
    // Check limit
    const today = new Date().toISOString().split('T')[0];
    if (dailyPolls.date !== today) {
      dailyPolls.date = today;
      dailyPolls.count = 0;
      dailyPolls.users = [];
    }

    if (dailyPolls.count >= pollLimit) {
      return interaction.reply({ 
        content: `❌ **The ${pollLimit} Polls of the Day have already been created!** Please try again tomorrow.`, 
        ephemeral: true 
      });
    }

    if (dailyPolls.users && dailyPolls.users.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ **You have already created a poll today!** Each person can only make 1 poll per day.',
        ephemeral: true
      });
    }

    // 2. Check channel
    const channelIds = (guildConfig.channelIds as Record<string, string>) || {};
    const pollChannelId = channelIds.pollOfTheDay || '1535616938104062012';
    const targetChannel = interaction.guild.channels.cache.get(pollChannelId) as TextChannel || interaction.channel as TextChannel;

    if (!targetChannel) {
      return interaction.reply({ content: '❌ Poll channel is invalid.', ephemeral: true });
    }

    // 3. Build Poll
    const question = interaction.options.getString('question', true);
    const answers = [
      { text: interaction.options.getString('option1', true) },
      { text: interaction.options.getString('option2', true) },
    ];
    
    const opt3 = interaction.options.getString('option3');
    if (opt3) answers.push({ text: opt3 });
    const opt4 = interaction.options.getString('option4');
    if (opt4) answers.push({ text: opt4 });
    const opt5 = interaction.options.getString('option5');
    if (opt5) answers.push({ text: opt5 });

    const duration = interaction.options.getInteger('duration') || 24;
    const multiselect = interaction.options.getBoolean('multiselect') || false;

    await interaction.deferReply({ ephemeral: true });

    try {
      const pollMsg = await targetChannel.send({
        content: `**Poll of the Day** created by <@${interaction.user.id}>`,
        poll: {
          question: { text: question },
          answers: answers,
          allowMultiselect: multiselect,
          duration: duration,
        }
      });

      // 4. Update Database
      dailyPolls.count += 1;
      if (!dailyPolls.users) dailyPolls.users = [];
      dailyPolls.users.push(interaction.user.id);
      settings.dailyPolls = dailyPolls;

      await prisma.guildConfig.update({
        where: { guildId: interaction.guild.id },
        data: { settings },
      });

      return interaction.editReply({ content: `✅ **Poll successfully created in <#${targetChannel.id}>!** (${dailyPolls.count}/${pollLimit} created today)` });
    } catch (e) {
      console.error('Failed to create poll:', e);
      return interaction.editReply({ content: '❌ Failed to create poll. Does the bot have permission?' });
    }
  }
};
