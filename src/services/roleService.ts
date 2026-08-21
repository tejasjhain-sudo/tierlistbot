import { Guild, GuildMember, TextChannel, PermissionFlagsBits } from 'discord.js';
import { Mode, Region, Tier } from '../config/constants';
import prisma from '../database/prisma';

// ─── Helper: Get guild config role IDs ───────────────────────────────────────
async function getRoleIds(guildId: string): Promise<Record<string, any>> {
  const cfg = await prisma.guildConfig.findUnique({ where: { guildId } });
  return (cfg?.roleIds as Record<string, any>) ?? {};
}

// ─── Give role to member (safe) ───────────────────────────────────────────────
async function giveRole(member: GuildMember, roleId?: string): Promise<void> {
  if (!roleId) return;
  try {
    const role = member.guild.roles.cache.get(roleId);
    if (role && !member.roles.cache.has(roleId)) {
      await member.roles.add(role);
    }
  } catch (e) {
    console.warn(`Could not give role ${roleId} to ${member.id}:`, e);
  }
}

// ─── Remove role from member (safe) ──────────────────────────────────────────
async function removeRole(member: GuildMember, roleId?: string): Promise<void> {
  if (!roleId) return;
  try {
    const role = member.guild.roles.cache.get(roleId);
    if (role && member.roles.cache.has(roleId)) {
      await member.roles.remove(role);
    }
  } catch (e) {
    console.warn(`Could not remove role ${roleId} from ${member.id}:`, e);
  }
}

// ─── Give Registered role ────────────────────────────────────────────────────
export async function giveRegisteredRole(member: GuildMember): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  await giveRole(member, roleIds.registered);
}

// ─── Give Authorised (Verified) role ──────────────────────────────────────────
export async function giveAuthorisedRole(member: GuildMember): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  let roleId = roleIds.authorised || roleIds.verified;
  if (!roleId) {
    const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'authorised' || r.name.toLowerCase() === 'verified');
    if (role) roleId = role.id;
  }
  await giveRole(member, roleId);
}

// ─── Give Unauthorised role ──────────────────────────────────────────────────
export async function giveUnauthorisedRole(member: GuildMember): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  let roleId = roleIds.unauthorised || roleIds.unverified;
  if (!roleId) {
    const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified');
    if (role) roleId = role.id;
  }
  await giveRole(member, roleId);
}

// ─── Remove Unauthorised role ────────────────────────────────────────────────
export async function removeUnauthorisedRole(member: GuildMember): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  let roleId = roleIds.unauthorised || roleIds.unverified;
  if (!roleId) {
    const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'unauthorised' || r.name.toLowerCase() === 'unverified');
    if (role) roleId = role.id;
  }
  await removeRole(member, roleId);
}

// ─── Swap waitlist roles when mode changes ────────────────────────────────────
export async function swapWaitlistRole(
  member: GuildMember,
  oldMode: Mode | null,
  newMode: Mode
): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  if (oldMode && roleIds.waitlists?.[oldMode]) {
    await removeRole(member, roleIds.waitlists[oldMode]);
  }
  if (roleIds.waitlists?.[newMode]) {
    await giveRole(member, roleIds.waitlists[newMode]);
  }
}

// ─── Remove waitlist role ─────────────────────────────────────────────────────
export async function removeWaitlistRole(member: GuildMember, mode: Mode): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  await removeRole(member, roleIds.waitlists?.[mode]);
}

// ─── Give waitlist role (restore) ─────────────────────────────────────────────
export async function giveWaitlistRole(member: GuildMember, mode: Mode): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  await giveRole(member, roleIds.waitlists?.[mode]);
}

// ─── Update tier role (remove old, add new) ───────────────────────────────────
export async function updateTierRole(
  member: GuildMember,
  mode: Mode,
  previousTier: Tier | null,
  newTier: Tier
): Promise<void> {
  const roleIds = await getRoleIds(member.guild.id);
  const tierRoles = roleIds.tiers?.[mode];
  if (!tierRoles) return;

  // Remove old tier role for this mode only
  if (previousTier && previousTier !== 'Unranked' && tierRoles[previousTier]) {
    await removeRole(member, tierRoles[previousTier]);
  }

  // Add new tier role
  if (newTier !== 'Unranked' && tierRoles[newTier]) {
    await giveRole(member, tierRoles[newTier]);
  }
}

// ─── Update ticket permissions ─────────────────────────────────────────────────
export async function setTicketPermissions(
  channel: TextChannel,
  playerDiscordId: string,
  testerDiscordId: string
): Promise<void> {
  const guild = channel.guild;
  const roleIds = await getRoleIds(guild.id);

  const everyoneRole = guild.roles.everyone;

  // Deny everyone
  await channel.permissionOverwrites.edit(everyoneRole, { ViewChannel: false });

  // Allow player
  try {
    await channel.permissionOverwrites.edit(playerDiscordId, { ViewChannel: true, SendMessages: true });
  } catch {}

  // Allow tester
  try {
    await channel.permissionOverwrites.edit(testerDiscordId, { ViewChannel: true, SendMessages: true });
  } catch {}

  // Allow Tier Manager and Tier Admin
  for (const roleKey of ['tierManager', 'tierAdmin']) {
    const roleId = roleIds[roleKey];
    if (roleId) {
      try {
        await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true });
      } catch {}
    }
  }
}

// ─── Automatically sync a single member's registered role & mode tier roles ────
export async function syncGuildMemberRoles(member: GuildMember): Promise<boolean> {
  try {
    const player = await prisma.player.findUnique({
      where: { discordId: member.id },
      include: { tiers: true },
    });
    if (!player) return false;

    // 1. Give Authorised role and remove Unauthorised role
    await giveAuthorisedRole(member);
    await removeUnauthorisedRole(member);

    // 2. Give Registered role
    await giveRegisteredRole(member);

    // 3. Assign tier roles for each ranked gamemode
    if (player.tiers && player.tiers.length > 0) {
      for (const t of player.tiers) {
        if (t.currentTier && t.currentTier !== 'Unranked') {
          await updateTierRole(member, t.mode as Mode, null, t.currentTier as Tier);
        }
      }
    }

    return true;
  } catch (e) {
    console.warn(`[Auto-Sync] Could not sync roles for member ${member.user.tag}:`, e);
    return false;
  }
}

// ─── Automatically sync all database registered players present in a guild ───
export async function syncAllGuildMembers(guild: Guild): Promise<{ synced: number, total: number }> {
  try {
    const players = await prisma.player.findMany({
      include: { tiers: true },
    });

    if (players.length === 0) return { synced: 0, total: 0 };

    await guild.members.fetch().catch(() => {});

    let syncedCount = 0;
    for (const p of players) {
      const member = guild.members.cache.get(p.discordId);
      if (!member) continue;

      await giveAuthorisedRole(member);
      await removeUnauthorisedRole(member);
      await giveRegisteredRole(member);

      if (p.tiers && p.tiers.length > 0) {
        for (const t of p.tiers) {
          if (t.currentTier && t.currentTier !== 'Unranked') {
            await updateTierRole(member, t.mode as Mode, null, t.currentTier as Tier);
          }
        }
      }

      syncedCount++;
    }

    return { synced: syncedCount, total: players.length };
  } catch (e) {
    console.error(`[Auto-Sync] Error during guild members role sync:`, e);
    return { synced: 0, total: 0 };
  }
}

