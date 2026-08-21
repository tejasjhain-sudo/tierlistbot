import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

export default {
  data: new SlashCommandBuilder()
    .setName('mass-invite')
    .setDescription('DM players with an invite link.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt
        .setName('link')
        .setDescription('The Discord invite link (e.g., https://discord.gg/...)')
        .setRequired(true)
    )
    .addStringOption(opt => 
      opt
        .setName('target')
        .setDescription('Who should receive the DM?')
        .setRequired(true)
        .addChoices(
          { name: 'Registered Players Only', value: 'registered' },
          { name: 'Unregistered Members Only', value: 'unregistered' },
          { name: 'Everyone in Server', value: 'everyone' }
        )
    )
    .addUserOption(opt => 
      opt
        .setName('test_user')
        .setDescription('Optional: Send a test DM to a specific user instead of everyone.')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used in a server.', ephemeral: true });
    }

    const inviteLink = interaction.options.getString('link', true);
    const target = interaction.options.getString('target', true);
    const testUser = interaction.options.getUser('test_user');

    await interaction.deferReply({ ephemeral: true });

    let targetsToDM: string[] = [];

    if (testUser) {
      targetsToDM = [testUser.id];
    } else {
      const registeredRecords = await prisma.player.findMany({ select: { discordId: true } });
      const registeredIds = new Set(registeredRecords.map(r => r.discordId));

      if (target === 'registered') {
        targetsToDM = Array.from(registeredIds);
      } else {
        // We need all members in the discord server
        await interaction.guild.members.fetch(); // Fetch all members to cache
        const allMembers = interaction.guild.members.cache;
        
        for (const [id, member] of allMembers) {
          if (member.user.bot) continue; // Don't DM bots

          if (target === 'unregistered' && !registeredIds.has(id)) {
            targetsToDM.push(id);
          } else if (target === 'everyone') {
            targetsToDM.push(id);
          }
        }
      }
    }

    if (targetsToDM.length === 0) {
      return interaction.editReply('❌ No players found to message based on those filters.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🚀 Mass DM Started')
      .setDescription(`Attempting to send an invite DM to **${targetsToDM.length}** users...\n\n*Note: This will take several minutes to avoid Discord rate limits. Do not restart the bot.*`)
      .setColor(COLORS.PRIMARY);

    await interaction.editReply({ embeds: [embed] });

    let successCount = 0;
    let failCount = 0;

    const dmEmbed = new EmbedBuilder()
      .setTitle('🚨 URGENT: Server Migration!')
      .setDescription(
        `Hey! We are moving to a brand new Discord server and we need you to join ASAP!\n\n` +
        `**Please join immediately** using the button below. Once you join, your Minecraft account, Tiers, and roles will be automatically restored!`
      )
      .setColor(0xE74C3C)
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Join New Server')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteLink)
    );

    for (const discordId of targetsToDM) {
      try {
        const user = await interaction.client.users.fetch(discordId);
        await user.send({
          embeds: [dmEmbed],
          components: [row],
        });
        successCount++;
      } catch (error) {
        // Player might have DMs closed or left all shared servers
        failCount++;
      }

      // Wait 1.5 seconds between each DM to prevent the bot from being rate-limited or flagged for spam
      await new Promise(r => setTimeout(r, 1500));
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Mass DM Complete')
      .setDescription(`Finished messaging all users.\n\n**Successfully Sent:** ${successCount}\n**Failed (DMs Closed):** ${failCount}`)
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed] });
  },
};
