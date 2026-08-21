import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  CategoryChannel,
  TextChannel,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';

const data = new SlashCommandBuilder()
  .setName('tester-area')
  .setDescription('Sets up the Tier Testers category, channels, and command guide.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const guildConfig = await prisma.guildConfig.findUnique({
    where: { guildId: interaction.guild.id }
  });

  if (!guildConfig) {
    return interaction.editReply('❌ Server not configured. Please run `/setup` first.');
  }

  const roleIds = guildConfig.roleIds as any;
  const testerRoleId = roleIds?.tierTester;

  if (!testerRoleId) {
    return interaction.editReply('❌ Tester role not found in configuration.');
  }

  try {
    // Create Category
    const category = await interaction.guild.channels.create({
      name: '🛠️ Tier Testers',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: testerRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    }) as CategoryChannel;

    // Create Chat Channel
    await interaction.guild.channels.create({
      name: '💬・tester-chat',
      type: ChannelType.GuildText,
      parent: category.id,
    });

    // Create Commands Guide Channel
    const commandsChannel = await interaction.guild.channels.create({
      name: '🤖・tester-commands',
      type: ChannelType.GuildText,
      parent: category.id,
    }) as TextChannel;

    // Build the guide embed
    const embed = new EmbedBuilder()
      .setTitle('🛠️ Tester Command Guide')
      .setDescription('Welcome to the Tier Testers team! Below is a complete guide on how to use the bot and perform tests.')
      .setColor(COLORS.PRIMARY)
      .addFields(
        { 
          name: '1️⃣ Accepting Testers', 
          value: 'When a player applies for Tier Testing, their application will appear in the applications channel. Click **✅ Accept** to automatically give them the Waitlist role for their requested mode.'
        },
        { 
          name: '2️⃣ Starting a Test (`/next`)', 
          value: 'Use the `/next` command to pull the next player from the waitlist into a private testing ticket. The bot will automatically ping them.'
        },
        { 
          name: '3️⃣ Assigning a Tier', 
          value: 'Once the test is finished, click the **Complete Test** button on the tierlist ticket to assign them their new tier. The bot will automatically update their roles and close the ticket.'
        },
        { 
          name: '4️⃣ Checking History (`/history`)', 
          value: 'You can view a player\'s past test history, including who tested them and what tiers they received, using the `/history` command.'
        },
        { 
          name: '5️⃣ Missing / No Show', 
          value: 'If a player does not show up for their test, click the **Cancel Session** button on their ticket. If they need to be blacklisted, notify a Tier Admin to handle it.'
        }
      )
      .setFooter({ text: 'Thank you for your help in keeping the tiers accurate!' })
      .setTimestamp();

    await commandsChannel.send({ embeds: [embed] });

    await interaction.editReply(`✅ Tester Area successfully created in <#${category.id}>!`);
  } catch (error) {
    console.error('Failed to create tester area:', error);
    await interaction.editReply('❌ An error occurred while creating the tester area. Ensure I have Manage Channels permissions.');
  }
}

export default { data, execute };
