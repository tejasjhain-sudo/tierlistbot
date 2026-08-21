import { GuildMember } from 'discord.js';
import { syncGuildMemberRoles, giveUnauthorisedRole } from '../services/roleService';

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  // 1. Check if member is already authorized/registered in database
  const synced = await syncGuildMemberRoles(member);
  if (synced) {
    console.log(`[Auto-Sync] Automatically assigned Authorised & Registered roles to member: ${member.user.tag} (${member.id})`);
  } else {
    // 2. If brand new unverified member, give Unauthorised role so they only see #verify
    await giveUnauthorisedRole(member);
    console.log(`[Security] Assigned Unauthorised role to new member: ${member.user.tag} (${member.id})`);
  }
}


