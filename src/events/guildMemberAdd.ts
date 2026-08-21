import { GuildMember } from 'discord.js';
import { syncGuildMemberRoles } from '../services/roleService';

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const synced = await syncGuildMemberRoles(member);
  if (synced) {
    console.log(`[Auto-Sync] Automatically assigned Registered & Tier roles to joined member: ${member.user.tag} (${member.id})`);
  }
}
