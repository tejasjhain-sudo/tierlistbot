import { Mode, Tier } from '../config/constants';
import prisma from '../database/prisma';
import { Guild, GuildMember } from 'discord.js';
import { updateTierRole } from './roleService';

// ─── Get player profile ───────────────────────────────────────────────────────
export async function getPlayerByDiscordId(discordId: string) {
  return prisma.player.findUnique({
    where: { discordId },
    include: {
      tiers: true,
      tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export async function getPlayerByMinecraftUsername(username: string) {
  return prisma.player.findUnique({
    where: { minecraftUsernameLower: username.toLowerCase() },
    include: {
      tiers: true,
      tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

// ─── Get tier history (paginated) ────────────────────────────────────────────
export async function getTierHistory(discordId: string, mode?: Mode, page = 1, pageSize = 10) {
  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return null;

  const where: any = { playerId: player.id };
  if (mode) where.mode = mode;

  const [entries, total] = await Promise.all([
    prisma.tierHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tierHistory.count({ where }),
  ]);

  return { entries, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

// ─── Get leaderboard ──────────────────────────────────────────────────────────
export async function getLeaderboard(mode: Mode, region?: string, page = 1, pageSize = 20) {
  const tierOrder = ['HT1','LT1','HT2','LT2','HT3','LT3','HT4','LT4','HT5','LT5','Unranked'];

  const where: any = { mode };

  const [tiers, total] = await Promise.all([
    prisma.playerTier.findMany({
      where,
      include: { player: true },
      orderBy: [
        { lastTestedAt: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize * 5, // fetch more to allow sorting
    }),
    prisma.playerTier.count({ where }),
  ]);

  // Filter by region if provided
  const filtered = region
    ? tiers.filter(t => t.player.region === region)
    : tiers;

  // Sort by tier order then lastTestedAt
  filtered.sort((a, b) => {
    const aOrder = tierOrder.indexOf(a.currentTier);
    const bOrder = tierOrder.indexOf(b.currentTier);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.lastTestedAt?.getTime() ?? 0) - (a.lastTestedAt?.getTime() ?? 0);
  });

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    entries: paginated,
    total: filtered.length,
    page,
    pageSize,
    pages: Math.ceil(filtered.length / pageSize),
  };
}

// ─── Staff: set player tier manually ─────────────────────────────────────────
export async function setPlayerTier(
  guild: Guild,
  discordId: string,
  mode: Mode,
  tier: Tier,
  actorDiscordId: string
): Promise<{ success: boolean; message: string }> {

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, message: 'Player not found.' };

  const existing = await prisma.playerTier.findUnique({
    where: { playerId_mode: { playerId: player.id, mode } },
  });

  await prisma.playerTier.upsert({
    where: { playerId_mode: { playerId: player.id, mode } },
    update: { previousTier: existing?.currentTier, currentTier: tier, lastTesterDiscordId: actorDiscordId, lastTestedAt: new Date() },
    create: { playerId: player.id, mode, currentTier: tier, lastTesterDiscordId: actorDiscordId, lastTestedAt: new Date() },
  });

  // Update role
  try {
    const member = await guild.members.fetch(discordId);
    await updateTierRole(member, mode, (existing?.currentTier as Tier | null) ?? null, tier);
  } catch {}

  await prisma.auditLog.create({
    data: {
      guildId: guild.id,
      actorDiscordId,
      action: 'STAFF_SET_TIER',
      targetDiscordId: discordId,
      metadata: { mode, tier, previousTier: existing?.currentTier },
    },
  });

  return { success: true, message: `Set **${player.minecraftUsername}**'s ${mode} tier to \`${tier}\`.` };
}

// ─── Staff: remove player tier ────────────────────────────────────────────────
export async function removePlayerTier(
  guild: Guild,
  discordId: string,
  mode: Mode,
  actorDiscordId: string
): Promise<{ success: boolean; message: string }> {

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, message: 'Player not found.' };

  const existing = await prisma.playerTier.findUnique({
    where: { playerId_mode: { playerId: player.id, mode } },
  });
  if (!existing) return { success: false, message: 'Player has no tier for that mode.' };

  await prisma.playerTier.delete({
    where: { playerId_mode: { playerId: player.id, mode } },
  });

  // Remove role
  try {
    const member = await guild.members.fetch(discordId);
    await updateTierRole(member, mode, existing.currentTier as Tier, 'Unranked');
  } catch {}

  await prisma.auditLog.create({
    data: {
      guildId: guild.id,
      actorDiscordId,
      action: 'STAFF_REMOVE_TIER',
      targetDiscordId: discordId,
      metadata: { mode, previousTier: existing.currentTier },
    },
  });

  return { success: true, message: `Removed **${player.minecraftUsername}**'s ${mode} tier.` };
}
