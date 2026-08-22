import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('send-staff-panel')
    .setDescription('[Admin] Deploy the Staff Application Panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to send panel to (defaults to current channel)').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // Auto-create staff-logs channel if it doesn't exist
    let logChannel = interaction.guild.channels.cache.find(
      c => c.name === 'staff-logs' && c.type === ChannelType.GuildText
    );
    if (!logChannel) {
      try {
        await interaction.guild.channels.create({
          name: 'staff-logs',
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
          ],
        });
      } catch (err) {
        console.error('Failed to auto-create staff-logs channel:', err);
      }
    }

    const targetChannel = (interaction.options.getChannel('channel') as TextChannel) || (interaction.channel as TextChannel);

    const embed = new EmbedBuilder()
      .setTitle('📝 Staff Apply')
      .setDescription(
        '# STAFF REQUIREMENT\n\n' +
        'Welcome to the applications panel of Arix Tierlist! If you are passionate about helping Arix Tierlist and contributing to its growth, you can apply for staff using the dropdown menu below.\n\n' +
        'You can apply for:\n' +
        '**Staff Team**\n\n' +
        '• You must be at least 14 years of age.\n' +
        '• You must be able to record and have a good microphone.\n' +
        '• Please take your time and fill out the application professionally.\n' +
        '• Usage of AI is strictly prohibited and would cause an application blacklist.\n' +
        '• Vouches aren\'t really required.\n\n' +
        'Good Luck with your Applications!\n\n' +
        '⚙️ **Apply**'
      )
      .setColor(COLORS.RESULT)
      .setTimestamp();

    const selectOption = new StringSelectMenuOptionBuilder()
      .setLabel('Staff Team')
      .setDescription('Apply to join the Arix staff team.')
      .setValue('staff_team_apply')
      .setEmoji('📝');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('staff_apply_select')
      .setPlaceholder('Make a selection')
      .addOptions(selectOption);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    try {
      const recent = await targetChannel.messages.fetch({ limit: 15 });
      const botMessages = Array.from(recent.values()).filter(m => m.author.id === interaction.client.user?.id);
      for (const bMsg of botMessages) {
        try { await bMsg.delete(); } catch {}
      }
    } catch {}

    await targetChannel.send({ embeds: [embed], components: [row] });

    return interaction.editReply({ content: `✅ Staff application panel sent in <#${targetChannel.id}>!` });
  },
};
