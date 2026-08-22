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
    .setName('reset-registrations')
    .setDescription('[Admin] Remove Minecraft registrations and Registered role from all members.')
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
    const waitlistRoles = Object.values(roleIds.waitlists || {}) as string[];

    const members = Array.from(guild.members.cache.values()).filter(m => !m.user.bot && m.id !== guild.ownerId);

    let removedRoleCount = 0;

    // 1. Remove Registered and waitlist roles from all server members
    for (const member of members) {
      try {
        if (registeredRole && member.roles.cache.has(registeredRole.id)) {
          await member.roles.remove(registeredRole);
          removedRoleCount++;
        }
        for (const wRoleId of waitlistRoles) {
          if (member.roles.cache.has(wRoleId)) {
            await member.roles.remove(wRoleId).catch(() => {});
          }
        }
      } catch (err) {
        console.warn(`Could not remove roles for ${member.user.tag}:`, err);
      }
    }

    // 2. Clear player registration data from database
    const deletedPlayers = await prisma.player.deleteMany({});
    await prisma.queueEntry.deleteMany({});

    // 3. Refresh all waitlists and panels
    await sendOrUpdateAllServerPanels(guild);

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Registrations Reset Complete')
      .setDescription(
        `Successfully removed **${deletedPlayers.count}** registered player profiles from the database and stripped the **Registered** role from **${removedRoleCount}** members.\n\n` +
        `All players must now verify and register their Minecraft accounts fresh via the panel!`
      )
      .setColor(COLORS.SUCCESS)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
