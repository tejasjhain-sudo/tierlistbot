import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';
import { COLORS } from '../../config/constants';

const PING_ROLES = [
  { id: 'announcement', label: 'Announcement', roleName: 'Announcement Ping' },
  { id: 'poll', label: 'Poll of the Day', roleName: 'Poll of the Day Ping' },
  { id: 'updates', label: 'Updates', roleName: 'Updates Ping' },
  { id: 'events', label: 'Events', roleName: 'Events Ping' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('send-ping-panel')
    .setDescription('Send a panel allowing users to self-assign ping roles.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('Channel to send panel to (defaults to current channel)').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const targetChannel = (interaction.options.getChannel('channel') as TextChannel) || (interaction.channel as TextChannel);

    // Ensure the 4 roles exist in the guild
    for (const r of PING_ROLES) {
      let existingRole = interaction.guild.roles.cache.find(role => role.name === r.roleName);
      if (!existingRole) {
        try {
          await interaction.guild.roles.create({
            name: r.roleName,
            reason: 'Auto-created by send-ping-panel command.',
          });
        } catch (err) {
          console.error(`Failed to create role ${r.roleName}:`, err);
          return interaction.editReply({ content: `❌ Failed to create role **${r.roleName}**. Make sure the bot has permission to manage roles.` });
        }
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🔔 Notification Settings')
      .setDescription(
        'Select the roles you would like to be pinged for below!\n' +
        'You can select multiple options, and unselect them at any time.'
      )
      .setColor(COLORS.PRIMARY)
      .setTimestamp();

    const selectOptions = PING_ROLES.map(r =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.label)
        .setValue(r.id)
        .setDescription(`Get pinged for server ${r.roleName.toLowerCase()}s`)
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ping_roles_select')
      .setPlaceholder('Select notification pings...')
      .setMinValues(0)
      .setMaxValues(PING_ROLES.length)
      .addOptions(selectOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    try {
      const recent = await targetChannel.messages.fetch({ limit: 15 });
      const botMessages = Array.from(recent.values()).filter(m => m.author.id === interaction.client.user?.id);
      for (const bMsg of botMessages) {
        try { await bMsg.delete(); } catch {}
      }
    } catch {}

    await targetChannel.send({ embeds: [embed], components: [row] });

    return interaction.editReply({ content: `✅ Ping roles panel sent in <#${targetChannel.id}>!` });
  },
};
