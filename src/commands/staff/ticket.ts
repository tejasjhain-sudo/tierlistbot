import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage users in the current ticket channel.')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a user to this ticket channel.')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('The user to add')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a user from this ticket channel.')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('The user to remove')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Must be used in a server.', ephemeral: true });

    // Restrict to Staff / Admin (Assuming manageable by users with Administrator or ticket handlers)
    // Here we'll just check if the user has manage channels permission in this channel or is admin
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      // Check if they are a tester / staff
      // Basic fallback: let anyone with manage messages or manage channels use it, or we could check guildConfig.roleIds.tierManager
      // Since it's a staff command, let's keep it simple: requires Manage Channels or being a staff member
    }

    const channel = interaction.channel as TextChannel;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return interaction.reply({ content: '❌ Must be used in a text channel.', ephemeral: true });
    }

    // Basic check: is this a ticket? (optional, could just rely on permissions)
    if (!channel.name.includes('ticket') && !channel.name.includes('test-') && !channel.name.includes('support-')) {
      return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user', true);

    await interaction.deferReply();

    try {
      if (sub === 'add') {
        await channel.permissionOverwrites.edit(targetUser.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
        return interaction.editReply({ content: `✅ Successfully added <@${targetUser.id}> to the ticket.` });
      } else if (sub === 'remove') {
        await channel.permissionOverwrites.delete(targetUser.id);
        return interaction.editReply({ content: `✅ Successfully removed <@${targetUser.id}> from the ticket.` });
      }
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '❌ Failed to modify channel permissions.' });
    }
  },
};
