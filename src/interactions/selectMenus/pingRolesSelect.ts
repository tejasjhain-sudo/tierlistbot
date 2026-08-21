import { StringSelectMenuInteraction, EmbedBuilder } from 'discord.js';
import { COLORS } from '../../config/constants';

const PING_ROLES = [
  { id: 'announcement', label: 'Announcement', roleName: 'Announcement Ping' },
  { id: 'poll', label: 'Poll of the Day', roleName: 'Poll of the Day Ping' },
  { id: 'updates', label: 'Updates', roleName: 'Updates Ping' },
  { id: 'events', label: 'Events', roleName: 'Events Ping' },
];

export async function handlePingRolesSelect(interaction: StringSelectMenuInteraction): Promise<any> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const selectedIds = interaction.values;
  const member = await interaction.guild.members.fetch(interaction.user.id);

  const rolesAdded: string[] = [];
  const rolesRemoved: string[] = [];

  for (const r of PING_ROLES) {
    const role = interaction.guild.roles.cache.find(role => role.name === r.roleName);
    if (!role) continue;

    const isSelected = selectedIds.includes(r.id);
    const hasRole = member.roles.cache.has(role.id);

    if (isSelected && !hasRole) {
      try {
        await member.roles.add(role);
        rolesAdded.push(r.label);
      } catch (err) {
        console.error(`Failed to add role ${r.roleName}:`, err);
      }
    } else if (!isSelected && hasRole) {
      try {
        await member.roles.remove(role);
        rolesRemoved.push(r.label);
      } catch (err) {
        console.error(`Failed to remove role ${r.roleName}:`, err);
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('🔔 Notification Preferences Updated')
    .setColor(COLORS.SUCCESS)
    .setTimestamp();

  let desc = 'Your notification roles have been successfully updated!\n\n';
  
  // Show currently active roles
  const activeRoles: string[] = [];
  for (const r of PING_ROLES) {
    const role = interaction.guild.roles.cache.find(role => role.name === r.roleName);
    if (role && member.roles.cache.has(role.id)) {
      activeRoles.push(`• **${r.label}**`);
    }
  }

  desc += `**Active Subscriptions:**\n${activeRoles.length > 0 ? activeRoles.join('\n') : '_None_'}\n\n`;

  if (rolesAdded.length > 0) {
    desc += `➕ **Subscribed to:** ${rolesAdded.join(', ')}\n`;
  }
  if (rolesRemoved.length > 0) {
    desc += `➖ **Unsubscribed from:** ${rolesRemoved.join(', ')}\n`;
  }

  embed.setDescription(desc);

  return interaction.editReply({ embeds: [embed] });
}
