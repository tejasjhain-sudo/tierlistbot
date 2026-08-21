import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import prisma from '../../database/prisma';

export default {
  data: new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Send a DM to an AFK player in a ticket telling them to respond.')
    .addUserOption(opt =>
      opt.setName('player')
        .setDescription('The player to notify')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    // Ensure user is staff or active tester
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: interaction.guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
    
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    let member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null) ?? undefined;
    }

    const isAdmin = isOwner || isAdminPerm || (roleIds.tierAdmin ? (member?.roles.cache.has(roleIds.tierAdmin) ?? false) : false);
    const isStaff = isAdmin || (roleIds.tierManager ? (member?.roles.cache.has(roleIds.tierManager) ?? false) : false);

    // Also allow if they are an active tester
    const tester = await prisma.tester.findUnique({ where: { discordId: interaction.user.id } });
    const isActiveTester = tester?.active;

    if (!isStaff && !isActiveTester) {
      return interaction.editReply({ content: '❌ Only staff and active testers can use this command.' });
    }

    const targetUser = interaction.options.getUser('player', true);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Tier Testing Notification')
      .setDescription(`Hello! <@${interaction.user.id}> is waiting for you in your Tier Testing ticket.\n\n**Please respond to the ticket or you may be skipped and returned to the queue.**`)
      .setColor(COLORS.WARNING)
      .setTimestamp();

    try {
      await targetUser.send({ embeds: [embed] });
      await interaction.editReply({ content: `✅ Successfully notified <@${targetUser.id}> via Direct Message.` });
    } catch (error) {
      await interaction.editReply({ content: `❌ Could not send a DM to <@${targetUser.id}>. They may have DMs disabled.` });
    }
  },
};
