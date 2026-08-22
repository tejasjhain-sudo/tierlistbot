import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import prisma from '../../database/prisma';
import { COLORS } from '../../config/constants';
import { sendOrUpdateAllServerPanels } from '../../services/panelService';

export default {
  data: new SlashCommandBuilder()
    .setName('reset-all-roles')
    .setDescription('[Admin] Strip Registered & Authorised roles from all members so they must verify.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Must be used inside a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only Server Administrators can run this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });
    const guild = interaction.guild;

    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const roleIds = (guildConfig?.roleIds as Record<string, any>) || {};

    const registeredRole = roleIds.registered ? guild.roles.cache.get(roleIds.registered) : guild.roles.cache.find(r => r.name.toLowerCase() === 'registered');
    const authorisedRole = roleIds.authorised ? guild.roles.cache.get(roleIds.authorised) : guild.roles.cache.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified');
    const unauthorisedRole = roleIds.unauthorised ? guild.roles.cache.get(roleIds.unauthorised) : guild.roles.cache.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified');

    const members = Array.from(guild.members.cache.values()).filter(m => !m.user.bot && m.id !== guild.ownerId);

    let removedCount = 0;

    for (const member of members) {
      try {
        if (registeredRole && member.roles.cache.has(registeredRole.id)) {
          await member.roles.remove(registeredRole);
        }
        if (authorisedRole && member.roles.cache.has(authorisedRole.id)) {
          await member.roles.remove(authorisedRole);
        }
        if (unauthorisedRole && !member.roles.cache.has(unauthorisedRole.id)) {
          await member.roles.add(unauthorisedRole);
        }
        removedCount++;
      } catch (err) {
        console.warn(`Could not reset roles for ${member.user.tag}:`, err);
      }
    }

    // Refresh panels across all channels
    await sendOrUpdateAllServerPanels(guild);

    const embed = new EmbedBuilder()
      .setTitle('🔄 Verification & Roles Reset Complete')
      .setDescription(
        `Successfully removed **Registered** & **Authorised** roles from **${removedCount}** server members.\n\n` +
        `All members now must complete **Step 1: Server Verification & Backup** to unlock the server and register their account!`
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
