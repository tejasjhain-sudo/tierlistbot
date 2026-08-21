import { Guild } from 'discord.js';
import { Mode, Region, QueueStatus, SessionStatus } from '../config/constants';
import prisma from '../database/prisma';
import { QUEUE_LOCK_TIMEOUT_MS } from '../config/constants';

// ─── Join queue ───────────────────────────────────────────────────────────────
export async function joinQueue(
  guildId: string,
  discordId: string,
  mode: Mode,
  region: Region
): Promise<{ success: boolean; position: number; message: string }> {

  // Check if testing is open for this mode
  const activeTester = await prisma.tester.findFirst({
    where: { guildId, active: true, activeMode: mode },
  });
  if (!activeTester) {
    return { success: false, position: 0, message: `Testing is currently offline for **${mode}**. You can only join when a tester opens the queue!` };
  }

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, position: 0, message: 'You are not registered. Please register first.' };
  if (player.isBanned) return { success: false, position: 0, message: 'You are banned from tier testing.' };

  // Check if blacklisted
  const blacklisted = await prisma.blacklist.findUnique({
    where: { guildId_discordId: { guildId, discordId } }
  });
  if (blacklisted) return { success: false, position: 0, message: `You are blacklisted from tier testing. Reason: ${blacklisted.reason}` };

  // Check for existing active queue entry in this mode
  const existing = await prisma.queueEntry.findFirst({
    where: { playerId: player.id, mode, status: QueueStatus.WAITING },
  });
  if (existing) return { success: false, position: 0, message: `You are already in the ${mode} queue.` };

  // Check if player is an active tester
  const activeTesterUser = await prisma.tester.findFirst({
    where: { discordId, guildId, active: true },
  });
  if (activeTesterUser) return { success: false, position: 0, message: 'Active testers cannot join the queue.' };

  // Check if player has an active session
  const activeSession = await prisma.testSession.findFirst({
    where: { playerId: player.id, status: SessionStatus.ACTIVE },
  });
  if (activeSession) return { success: false, position: 0, message: 'You already have an active test session.' };

  const entry = await prisma.queueEntry.create({
    data: { playerId: player.id, guildId, mode, region, status: QueueStatus.WAITING },
  });

  const position = await getQueuePosition(guildId, entry.id, mode);
  return { success: true, position, message: `You joined the ${mode} queue at position #${position}.` };
}

// ─── Leave queue ──────────────────────────────────────────────────────────────
export async function leaveQueue(
  guildId: string,
  discordId: string,
  mode: Mode
): Promise<{ success: boolean; message: string }> {

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, message: 'You are not registered.' };

  const entry = await prisma.queueEntry.findFirst({
    where: { playerId: player.id, mode, status: QueueStatus.WAITING },
  });
  if (!entry) return { success: false, message: `You are not in the ${mode} queue.` };

  await prisma.queueEntry.delete({ where: { id: entry.id } });
  return { success: true, message: `You have left the ${mode} queue.` };
}

// ─── Leave all queues ─────────────────────────────────────────────────────────
export async function leaveAllQueues(
  guildId: string,
  discordId: string
): Promise<{ success: boolean; count: number; message: string }> {

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, count: 0, message: 'You are not registered.' };

  const { count } = await prisma.queueEntry.deleteMany({
    where: { playerId: player.id, guildId, status: QueueStatus.WAITING },
  });

  return { success: true, count, message: `You have left ${count} queue(s).` };
}

// ─── Get queue position (1-based) ─────────────────────────────────────────────
export async function getQueuePosition(guildId: string, entryId: string, mode: Mode): Promise<number> {
  const entries = await prisma.queueEntry.findMany({
    where: { guildId, mode, status: QueueStatus.WAITING },
    orderBy: { joinedAt: 'asc' },
    select: { id: true },
  });
  const index = entries.findIndex(e => e.id === entryId);
  return index === -1 ? -1 : index + 1;
}

// ─── Claim next player (atomic, prevents race conditions) ─────────────────────
export async function claimNextPlayer(
  guildId: string,
  testerDiscordId: string,
  mode: Mode,
  region: Region | 'all'
): Promise<{ success: boolean; entry: any; message: string }> {

  return await prisma.$transaction(async (tx) => {
    // Expire stale locks first
    const lockExpiry = new Date(Date.now() - QUEUE_LOCK_TIMEOUT_MS);
    await tx.queueEntry.updateMany({
      where: { guildId, mode, status: QueueStatus.CLAIMED, lockedAt: { lt: lockExpiry } },
      data: { status: QueueStatus.WAITING, lockedAt: null, lockedByTesterId: null },
    });

    // Find next eligible player
    const whereClause: any = {
      guildId,
      mode,
      status: QueueStatus.WAITING,
    };
    if (region !== 'all') {
      whereClause.region = region;
    }

    const entry = await tx.queueEntry.findFirst({
      where: whereClause,
      orderBy: { joinedAt: 'asc' },
      include: { player: true },
    });

    if (!entry) {
      return { success: false, entry: null, message: 'No players in the queue for this mode/region.' };
    }

    // Atomically claim it
    const claimed = await tx.queueEntry.updateMany({
      where: { id: entry.id, status: QueueStatus.WAITING },
      data: { status: QueueStatus.CLAIMED, lockedAt: new Date(), lockedByTesterId: testerDiscordId },
    });

    if (claimed.count === 0) {
      return { success: false, entry: null, message: 'Another tester already claimed that player. Please try again.' };
    }

    return { success: true, entry, message: `Claimed ${entry.player.minecraftUsername} from the queue.` };
  });
}

// ─── Return player to queue ───────────────────────────────────────────────────
export async function returnToQueue(
  guildId: string,
  playerId: string,
  mode: Mode,
  region: Region,
  front: boolean
): Promise<void> {
  if (front) {
    // Put them at the very front by using a very old joinedAt
    await prisma.queueEntry.create({
      data: {
        playerId,
        guildId,
        mode,
        region,
        status: QueueStatus.WAITING,
        joinedAt: new Date(0),
      },
    });
  } else {
    await prisma.queueEntry.create({
      data: { playerId, guildId, mode, region, status: QueueStatus.WAITING },
    });
  }
}

// ─── Get full queue list for a mode ───────────────────────────────────────────
export async function getQueueList(guildId: string, mode: Mode, region?: Region) {
  return await prisma.queueEntry.findMany({
    where: {
      guildId,
      mode,
      status: QueueStatus.WAITING,
      ...(region ? { region } : {}),
    },
    include: { player: true },
    orderBy: { joinedAt: 'asc' },
  });
}

// ─── Staff: add player to queue ───────────────────────────────────────────────
export async function staffAddToQueue(
  guildId: string,
  discordId: string,
  mode: Mode,
  region: Region,
  actorDiscordId: string
) {
  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, message: 'Player not found.' };

  const existing = await prisma.queueEntry.findFirst({
    where: { playerId: player.id, mode, status: QueueStatus.WAITING },
  });
  if (existing) return { success: false, message: 'Player is already in that queue.' };

  await prisma.queueEntry.create({
    data: { playerId: player.id, guildId, mode, region, status: QueueStatus.WAITING },
  });

  await prisma.auditLog.create({
    data: {
      guildId,
      actorDiscordId,
      action: 'STAFF_ADD_QUEUE',
      targetDiscordId: discordId,
      metadata: { mode, region },
    },
  });

  return { success: true, message: `Added ${player.minecraftUsername} to the ${mode} queue.` };
}

// ─── Staff: remove player from queue ─────────────────────────────────────────
export async function staffRemoveFromQueue(
  guildId: string,
  discordId: string,
  mode: Mode,
  actorDiscordId: string
) {
  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return { success: false, message: 'Player not found.' };

  const entry = await prisma.queueEntry.findFirst({
    where: { playerId: player.id, mode, status: QueueStatus.WAITING },
  });
  if (!entry) return { success: false, message: 'Player is not in that queue.' };

  await prisma.queueEntry.delete({ where: { id: entry.id } });

  await prisma.auditLog.create({
    data: {
      guildId,
      actorDiscordId,
      action: 'STAFF_REMOVE_QUEUE',
      targetDiscordId: discordId,
      metadata: { mode },
    },
  });

  return { success: true, message: `Removed ${player.minecraftUsername} from the ${mode} queue.` };
}
