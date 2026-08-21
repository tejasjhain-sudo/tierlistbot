import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  Client,
  Guild,
  GuildMember,
} from 'discord.js';
import prisma from '../../database/prisma';

// Helper to replace :emoji_name: or :emoji_id: with actual custom emoji tags from any guild the bot is in
function parseClientEmojis(client: Client, text: string): string {
  return text.replace(/:([a-zA-Z0-9_~\-]{2,32}):/g, (match, name) => {
    if (/^\d+$/.test(name)) {
      const emoji = client.emojis.cache.get(name);
      if (emoji) return emoji.toString();
    }
    const emoji = client.emojis.cache.find(e => e.name?.toLowerCase() === name.toLowerCase());
    if (emoji) {
      return emoji.toString();
    }
    return match;
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('mass-dm')
    .setDescription('[Admin] Broadcast a direct message to server members.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('Who to send the DM to (defaults to Registered Only)')
        .setRequired(false)
        .addChoices(
          { name: 'All Server Members', value: 'all' },
          { name: 'Registered Players Only', value: 'registered' },
          { name: 'Non-Registered Members Only', value: 'non_registered' }
        )
    )
    .addUserOption(opt =>
      opt.setName('test-user').setDescription('Send a test message only to this user instead of broadcasting').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const testUser = interaction.options.getUser('test-user');
    const target = interaction.options.getString('target') || 'registered';
    
    const customId = testUser ? `mass_dm_modal_user_${testUser.id}` : `mass_dm_modal_target_${target}`;

    const modal = new ModalBuilder()
      .setCustomId(customId)
      .setTitle(testUser ? '📢 Send Test DM' : '📢 Broadcast Mass DM');

    const messageInput = new TextInputBuilder()
      .setCustomId('broadcast_message')
      .setLabel('Message to Send')
      .setPlaceholder('Paste your message here...')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(2000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput));

    await interaction.showModal(modal);
  },
};

export async function handleMassDMSubmit(interaction: ModalSubmitInteraction): Promise<any> {
  if (!interaction.guild) return interaction.reply({ content: '❌ Must be run in a server.', ephemeral: true });
  
  await interaction.deferReply({ ephemeral: true });

  let message = interaction.fields.getTextInputValue('broadcast_message');
  message = parseClientEmojis(interaction.client, message);

  const customId = interaction.customId;

  // 1. Handle single test user
  if (customId.startsWith('mass_dm_modal_user_')) {
    const targetUserId = customId.replace('mass_dm_modal_user_', '');
    try {
      const user = await interaction.client.users.fetch(targetUserId);
      await user.send(message);
      return interaction.editReply({ content: `✅ **Test DM Sent successfully** to <@${targetUserId}>!` });
    } catch (err) {
      return interaction.editReply({ content: `❌ **Failed to send Test DM** to <@${targetUserId}>. (DMs might be closed or blocked)` });
    }
  }

  // 2. Broadcast to selected target group
  const targetGroup = customId.replace('mass_dm_modal_target_', '');

  await interaction.editReply({ content: '⏳ Fetching server members...' });
  const allMembers = await interaction.guild.members.fetch().catch(() => null);
  if (!allMembers) {
    return interaction.editReply({ content: '❌ Failed to fetch server members.' });
  }

  // Filter out bots
  const humans = Array.from(allMembers.values()).filter(m => !m.user.bot);

  // Fetch registered player IDs from database
  const players = await prisma.player.findMany({ select: { discordId: true } });
  const registeredIds = new Set(players.map(p => p.discordId));

  let targetList: GuildMember[] = [];
  if (targetGroup === 'registered') {
    targetList = humans.filter(m => registeredIds.has(m.id));
  } else if (targetGroup === 'non_registered') {
    targetList = humans.filter(m => !registeredIds.has(m.id));
  } else {
    targetList = humans; // 'all'
  }

  if (targetList.length === 0) {
    return interaction.editReply({ content: `❌ No players matching target group \`${targetGroup}\` were found.` });
  }

  await interaction.editReply({ content: `⏳ Broadcast starting... Sending message to \`${targetList.length}\` users.` });

  let successCount = 0;
  let failCount = 0;

  for (const member of targetList) {
    try {
      await member.send(message);
      successCount++;
    } catch (err) {
      failCount++;
    }
    // Prevent hitting rapid API rate limits
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  return interaction.followUp({
    content: `📢 **Mass DM Broadcast Completed!**\n\n🎯 **Target Group:** \`${targetGroup}\`\n✅ **Successfully Sent:** \`${successCount}\` members\n❌ **Failed (DMs closed/blocked):** \`${failCount}\` members`,
    ephemeral: true,
  });
}
