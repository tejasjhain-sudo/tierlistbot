import { GuildMember } from 'discord.js';
import { syncGuildMemberRoles } from '../services/roleService';
import { sendMemberOnboarding } from '../services/onboardingService';

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  // 1. Automatically restore Registered & Tier roles if player is in database
  const synced = await syncGuildMemberRoles(member);
  if (synced) {
    console.log(`[Auto-Sync] Automatically assigned Registered & Tier roles to joined member: ${member.user.tag} (${member.id})`);
  }

  // 2. Send Onboarding message (Ping selection & OAuth backup authorization)
  await sendMemberOnboarding(member);
}

