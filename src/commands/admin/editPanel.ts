import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, TextChannel } from 'discord.js';

const data = new SlashCommandBuilder()
  .setName('edit-panel')
  .setDescription('Edit an existing panel message sent by the bot.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option => 
    option.setName('message_id')
      .setDescription('The ID of the message to edit')
      .setRequired(true))
  .addStringOption(option => 
    option.setName('title')
      .setDescription('New title for the embed')
      .setRequired(false))
  .addStringOption(option => 
    option.setName('description')
      .setDescription('New description for the embed (use \\n for newline)')
      .setRequired(false))
  .addStringOption(option => 
    option.setName('color')
      .setDescription('New hex color (e.g. #FF0000)')
      .setRequired(false));

async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const messageId = interaction.options.getString('message_id', true);
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const color = interaction.options.getString('color');

  if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
    return interaction.editReply('This command must be used in a text channel.');
  }

  try {
    const targetMessage = await interaction.channel.messages.fetch(messageId);
    if (!targetMessage) {
      return interaction.editReply('❌ Message not found in this channel.');
    }

    if (targetMessage.author.id !== interaction.client.user?.id) {
      return interaction.editReply('❌ I can only edit messages that I sent!');
    }

    const currentEmbed = targetMessage.embeds[0];
    if (!currentEmbed) {
      return interaction.editReply('❌ Message does not have an embed to edit.');
    }

    const newEmbed = EmbedBuilder.from(currentEmbed);
    
    if (title) newEmbed.setTitle(title.replace(/\\n/g, '\n'));
    if (description) newEmbed.setDescription(description.replace(/\\n/g, '\n'));
    if (color) {
      try {
        newEmbed.setColor(color as any);
      } catch (e) {
        return interaction.editReply('❌ Invalid color format. Use hex (e.g. #FF0000).');
      }
    }

    await targetMessage.edit({ embeds: [newEmbed] });
    await interaction.editReply('✅ Panel edited successfully!');
  } catch (error) {
    console.error('Error editing panel:', error);
    await interaction.editReply('❌ Failed to edit panel. Ensure the message ID is correct and in this channel.');
  }
}
export default { data, execute };
