import { StringSelectMenuInteraction, EmbedBuilder } from 'discord.js';
import { COLORS } from '../../config/constants';

export const PING_ROLES = [
  { id: 'testing', label: 'Testing Ping', keywords: ['testing ping'] },
  { id: 'announcement', label: 'Announcements Ping', keywords: ['announcement ping', 'announcements ping'] },
  { id: 'updates', label: 'Updates Ping', keywords: ['updates ping', 'update ping'] },
  { id: 'events', label: 'Events Ping', keywords: ['events ping', 'event ping'] },
  { id: 'poll', label: 'Poll of the Day', keywords: ['poll of the day ping', 'poll ping'] },
];

export async function handlePingRolesSelect(interaction: StringSelectMenuInteraction): Promise<any> {
  if (!interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  const selectedIds = interaction.values;
  const member = await interaction.guild.members.fetch(interaction.user.id);

  const rolesAdded: string[] = [];
  const rolesRemoved: string[] = [];

  for (const r of PING_ROLES) {
    const role = interaction.guild.roles.cache.find(role =>
      r.keywords.some(k => role.name.toLowerCase().includes(k) || role.name.toLowerCase() === k)
    );
    if (!role) continue;

    const isSelected = selectedIds.includes(r.id);
    const hasRole = member.roles.cache.has(role.id);

    if (isSelected && !hasRole) {
      try {
        await member.roles.add(role);
        rolesAdded.push(r.label);
      } catch (err) {
        console.error(`Failed to add role ${r.label}:`, err);
      }
    } else if (!isSelected && hasRole) {
      try {
        await member.roles.remove(role);
        rolesRemoved.push(r.label);
      } catch (err) {
        console.error(`Failed to remove role ${r.label}:`, err);
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
    const role = interaction.guild.roles.cache.find(role =>
      r.keywords.some(k => role.name.toLowerCase().includes(k) || role.name.toLowerCase() === k)
    );
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
