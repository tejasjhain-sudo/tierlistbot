import { Guild, GuildMember, TextChannel } from 'discord.js';
import { Mode, Region, Tier, SessionStatus, QueueStatus } from '../config/constants';
import prisma from '../database/prisma';
import { claimNextPlayer, returnToQueue } from './queueService';
import { createTestTicket, buildResultEmbed, buildHistoryEmbed } from './ticketService';
import { removeWaitlistRole, giveWaitlistRole, updateTierRole } from './roleService';
import { sendOrUpdateWaitlistPanel, pingTestingOpen, pingTestingClosed, sendOrUpdateAllWaitlistPanels } from './panelService';

// ─── Tester: start testing (Opens testing session for mode) ─────────────────
export async function startTesting(
  guild: Guild,
  testerDiscordId: string,
  mode: Mode,
  region: Region | 'all'
): Promise<{ success: boolean; message: string }> {

  // Check if this mode was previously offline
  const currentTester = await prisma.tester.findUnique({ where: { discordId: testerDiscordId } });
  const isAlreadyActiveForMode = currentTester?.active && currentTester?.activeMode === mode;
  
  const otherActiveCount = await prisma.tester.count({
    where: { guildId: guild.id, active: true, activeMode: mode, NOT: { discordId: testerDiscordId } },
  });
  
  const previouslyOnline = isAlreadyActiveForMode || otherActiveCount > 0;

  // Deactivate any previous active testers for this mode so old stuck testers don't linger
  await prisma.tester.updateMany({
    where: { guildId: guild.id, activeMode: mode, NOT: { discordId: testerDiscordId } },
    data: { active: false, activeMode: null, activeRegion: null },
  });

  // Upsert tester record for the primary tester starting testing
  await prisma.tester.upsert({
    where: { discordId: testerDiscordId },
    update: { active: true, activeMode: mode, activeRegion: region, startedAt: new Date(), lastActiveAt: new Date(), guildId: guild.id },
    create: { discordId: testerDiscordId, guildId: guild.id, active: true, activeMode: mode, activeRegion: region, startedAt: new Date(), lastActiveAt: new Date() },
  });

  // Remove tester from all queues
  await prisma.queueEntry.deleteMany({
    where: { guildId: guild.id, player: { discordId: testerDiscordId } }
  });

  // Reset any stuck CLAIMED queue entries for this mode to WAITING
  await prisma.queueEntry.updateMany({
    where: { guildId: guild.id, mode, status: QueueStatus.CLAIMED },
    data: { status: QueueStatus.WAITING, lockedAt: null, lockedByTesterId: null },
  });

  // Ping waitlist role if mode was previously offline & clear old stale queue entries
  if (!previouslyOnline) {
    // Clear old queue entries for this mode so queue starts completely empty
    await prisma.queueEntry.deleteMany({
      where: { guildId: guild.id, mode },
    });

    try {
      await pingTestingOpen(guild, mode, testerDiscordId);
    } catch (e) {
      console.error('Failed to send testing open ping:', e);
    }
  }

  // Update waitlist panel so queue opens for players
  await sendOrUpdateWaitlistPanel(guild, mode);
  return { success: true, message: `✅ Testing opened for **${mode}**. Use \`/next\` when you are ready to test the first player!` };
}

// ─── Tester: pull next player from queue into a ticket ────────────────────────
export async function pullNextPlayer(
  guild: Guild,
  testerDiscordId: string
): Promise<{ success: boolean; message: string; sessionId?: string }> {

  const tester = await prisma.tester.findUnique({ where: { discordId: testerDiscordId } });
  if (!tester || !tester.active || !tester.activeMode) {
    return { success: false, message: '❌ You must be an active tester to pull the next player. Run `/tiertest start <mode>` first.' };
  }

  const mode = tester.activeMode as Mode;
  const region = (tester.activeRegion as Region | 'all') ?? 'all';

  // Check for existing active test session for the SAME mode only
  const activeSessions = await prisma.testSession.count({
    where: { testerDiscordId, mode, status: SessionStatus.ACTIVE },
  });
  if (activeSessions > 0) {
    return { success: false, message: `❌ You already have an active **${mode}** ticket open. Complete or close it before pulling the next ${mode} player!` };
  }

  // Claim next player from queue
  const claim = await claimNextPlayer(guild.id, testerDiscordId, mode, region);
  if (!claim.success || !claim.entry) {
    return { success: false, message: `⚠️ ${claim.message}` };
  }

  const entry = claim.entry;
  const player = entry.player;
  const waitMinutes = Math.floor((Date.now() - new Date(entry.joinedAt).getTime()) / 60_000);

  // Get previous tier
  const playerTier = await prisma.playerTier.findUnique({
    where: { playerId_mode: { playerId: player.id, mode } },
  });
  const previousTier = (playerTier?.currentTier as Tier | null) ?? null;

  let session;
  try {
    session = await prisma.testSession.create({
      data: {
        guildId: guild.id,
        playerId: player.id,
        testerDiscordId,
        mode,
        region: entry.region as Region,
        status: SessionStatus.ACTIVE,
        previousTier,
        startedAt: new Date(),
      },
    });

    const channel = await createTestTicket(guild, {
      id: session.id,
      playerDiscordId: player.discordId,
      minecraftUsername: player.minecraftUsername,
      testerDiscordId,
      mode,
      region: entry.region as Region,
      previousTier,
      waitMinutes,
    });

    if (!channel) throw new Error('Failed to create ticket channel');

    await prisma.queueEntry.delete({ where: { id: entry.id } });

    await prisma.testSession.update({
      where: { id: session.id },
      data: { ticketChannelId: channel.id },
    });

    try {
      const member = await guild.members.fetch(player.discordId);
      await removeWaitlistRole(member, mode);
    } catch {}

    await sendOrUpdateWaitlistPanel(guild, mode);

    return { success: true, message: `✅ Created test ticket for **${player.minecraftUsername}** in ${channel}!`, sessionId: session.id };
  } catch (error: any) {
    console.error('Error creating test session:', error);
    if (session) {
      await prisma.testSession.update({ where: { id: session.id }, data: { status: SessionStatus.CANCELLED, cancelledAt: new Date() } });
    }
    try {
      await prisma.queueEntry.update({
        where: { id: entry.id },
        data: { status: QueueStatus.WAITING, lockedAt: null, lockedByTesterId: null },
      });
    } catch {}
    return { success: false, message: `❌ Failed to create test ticket: ${error.message}\nThe player has been returned to the queue.` };
  }
}

// ─── Manually create a ticket for a player (bypasses queue) ──────────────────
export async function createTicketForPlayer(
  guild: Guild,
  testerDiscordId: string,
  playerDiscordId: string,
  mode: Mode,
): Promise<{ success: boolean; message: string }> {

  const tester = await prisma.tester.findUnique({ where: { discordId: testerDiscordId } });
  if (!tester || !tester.active || tester.activeMode !== mode) {
    return { success: false, message: `You must run \`/tiertest start ${mode}\` before creating a ticket.` };
  }

  const activeCount = await prisma.testSession.count({ where: { testerDiscordId, mode, status: SessionStatus.ACTIVE } });
  if (activeCount > 0) {
    return { success: false, message: `You already have an active **${mode}** test session. Complete or cancel it first.` };
  }

  let player = await prisma.player.findUnique({ where: { discordId: playerDiscordId } });
  if (!player) {
    return { success: false, message: `<@${playerDiscordId}> is not registered. Ask them to register first.` };
  }

  const region = player.region as Region;

  const playerTier = await prisma.playerTier.findUnique({
    where: { playerId_mode: { playerId: player.id, mode } },
  });
  const previousTier = (playerTier?.currentTier as Tier | null) ?? null;

  const session = await prisma.testSession.create({
    data: {
      guildId: guild.id,
      playerId: player.id,
      testerDiscordId,
      mode,
      region,
      status: SessionStatus.ACTIVE,
      previousTier,
      startedAt: new Date(),
    },
  });

  const channel = await createTestTicket(guild, {
    id: session.id,
    playerDiscordId,
    minecraftUsername: player.minecraftUsername,
    testerDiscordId,
    mode,
    region,
    previousTier,
    waitMinutes: 0,
  });

  if (!channel) {
    await prisma.testSession.update({ where: { id: session.id }, data: { status: SessionStatus.CANCELLED, cancelledAt: new Date() } });
    return { success: false, message: 'Failed to create ticket channel. Is the category configured correctly?' };
  }

  await prisma.testSession.update({ where: { id: session.id }, data: { ticketChannelId: channel.id } });

  await prisma.queueEntry.deleteMany({ where: { guildId: guild.id, player: { discordId: playerDiscordId } } });
  await sendOrUpdateWaitlistPanel(guild, mode);

  return { success: true, message: `Ticket created for <@${playerDiscordId}> in ${channel}.` };
}

// ─── Tester: stop testing ─────────────────────────────────────────────────────
export async function stopTesting(
  guild: Guild,
  testerDiscordId: string,
  reason: string = 'Tier Testing Closed'
): Promise<{ success: boolean; message: string }> {

  const tester = await prisma.tester.findUnique({ where: { discordId: testerDiscordId } });
  if (!tester || !tester.active || !tester.activeMode) {
    return { success: false, message: 'You are not currently active as a tester.' };
  }

  const modeToClose = tester.activeMode as Mode;

  await prisma.tester.update({
    where: { discordId: testerDiscordId },
    data: { active: false, activeMode: null, activeRegion: null },
  });

  const remaining = await prisma.tester.count({
    where: { guildId: guild.id, active: true, activeMode: modeToClose },
  });
  
  if (remaining === 0) {
    await pingTestingClosed(guild, modeToClose, reason);
  } else {
    await sendOrUpdateWaitlistPanel(guild, modeToClose);
  }

  return { success: true, message: `Testing stopped for **${modeToClose}**. Queue closed and channel cleaned up.` };
}

// ─── Complete test ────────────────────────────────────────────────────────────
export async function completeTest(
  guild: Guild,
  sessionId: string,
  earnedTier: Tier,
  notes: string | null,
  evidenceUrl: string | null,
  actorDiscordId: string
): Promise<{ success: boolean; message: string }> {

  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: { player: true },
  });

  if (!session || session.status !== SessionStatus.ACTIVE) {
    return { success: false, message: 'Session not found or already completed.' };
  }

  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  const roleIds = (guildConfig?.roleIds as Record<string, any>) ?? {};
  let isAuthorized = session.testerDiscordId === actorDiscordId;

  if (!isAuthorized) {
    try {
      const actor = await guild.members.fetch(actorDiscordId);
      isAuthorized = actor.roles.cache.has(roleIds.tierManager) || actor.roles.cache.has(roleIds.tierAdmin);
    } catch {}
  }
  if (!isAuthorized) return { success: false, message: 'You are not authorized to complete this test.' };

  const player = session.player;
  const mode = session.mode as Mode;

  await prisma.$transaction(async (tx) => {
    await tx.testSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.COMPLETED, earnedTier, notes, evidenceUrl, completedAt: new Date() },
    });

    await tx.playerTier.upsert({
      where: { playerId_mode: { playerId: player.id, mode } },
      update: { previousTier: session.previousTier, currentTier: earnedTier, lastTesterDiscordId: actorDiscordId, lastTestedAt: new Date() },
      create: { playerId: player.id, mode, currentTier: earnedTier, previousTier: session.previousTier, lastTesterDiscordId: actorDiscordId, lastTestedAt: new Date() },
    });

    await tx.tierHistory.create({
      data: {
        playerId: player.id,
        testerDiscordId: actorDiscordId,
        guildId: guild.id,
        mode,
        region: session.region,
        previousTier: session.previousTier,
        earnedTier,
        notes,
        evidenceUrl,
        sessionId,
      },
    });

    await tx.auditLog.create({
      data: {
        guildId: guild.id,
        actorDiscordId,
        action: 'COMPLETE_TEST',
        targetDiscordId: player.discordId,
        metadata: { sessionId, mode, earnedTier, previousTier: session.previousTier },
      },
    });
  });

  const TESTED_ROLE_ID = '1525776685675577457';
  try {
    const member = await guild.members.fetch(player.discordId);
    await updateTierRole(member, mode, session.previousTier as Tier | null, earnedTier);
    try { await member.roles.add(TESTED_ROLE_ID); } catch {}
  } catch {}

  try {
    const channelIds = guildConfig?.channelIds as Record<string, string>;
    const earnedTierRoleId = roleIds?.tiers?.[mode]?.[earnedTier];

    const embed = buildResultEmbed({
      minecraftUsername: player.minecraftUsername,
      minecraftUuid: player.minecraftUuid,
      testerDiscordId: actorDiscordId,
      mode,
      region: session.region as Region,
      previousTier: session.previousTier as Tier | null,
      earnedTier,
      earnedTierRoleId,
      sessionId,
      notes: notes ?? undefined,
      evidenceUrl: evidenceUrl ?? undefined,
    });

    const updatesChannel = guild.channels.cache.get(channelIds?.updates) as TextChannel | undefined;
    if (updatesChannel) {
      const msg = await updatesChannel.send({
        content: `<@${player.discordId}>`,
        embeds: [embed],
      });
      try { await msg.react('🏆'); } catch {}
    }

    const secondaryChannel = guild.channels.cache.get('1525505395324354650') as TextChannel | undefined;
    if (secondaryChannel && secondaryChannel.id !== channelIds?.updates) {
      const msg2 = await secondaryChannel.send({
        content: `<@${player.discordId}>`,
        embeds: [embed],
      });
      try { await msg2.react('🏆'); } catch {}
    }

    const historyChannel = guild.channels.cache.get(channelIds?.history) as TextChannel | undefined;
    if (historyChannel) {
      const histEmbed = buildHistoryEmbed({
        minecraftUsername: player.minecraftUsername,
        testerDiscordId: actorDiscordId,
        mode,
        region: session.region as Region,
        previousTier: session.previousTier as Tier | null,
        earnedTier,
        sessionId,
      });
      await historyChannel.send({ embeds: [histEmbed] });
    }
  } catch (e) {
    console.error('Error publishing tier update:', e);
  }

  try {
    const member = await guild.members.fetch(player.discordId);
    await member.send(
      `🏆 Your tier test is complete!\n**Mode:** ${mode}\n**Result:** \`${earnedTier}\`\n\nCongratulations! Your tier has been updated on RearMC Tierlist.`
    );
  } catch {}

  await sendOrUpdateWaitlistPanel(guild, mode);

  return { success: true, message: `Test completed. ${player.minecraftUsername} earned \`${earnedTier}\`.` };
}

// ─── Skip player ──────────────────────────────────────────────────────────────
export async function skipPlayer(
  guild: Guild,
  sessionId: string,
  reason: string | null,
  returnAction: 'front' | 'back' | 'remove',
  actorDiscordId: string
): Promise<{ success: boolean; message: string }> {

  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: { player: true },
  });

  if (!session || session.status !== SessionStatus.ACTIVE) {
    return { success: false, message: 'Session not found or already closed.' };
  }

  await prisma.testSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.SKIPPED, skipReason: reason, skippedAt: new Date() },
  });

  const player = session.player;
  const mode = session.mode as Mode;

  if (returnAction !== 'remove') {
    await returnToQueue(guild.id, player.id, mode, session.region as Region, returnAction === 'front');
    try {
      const member = await guild.members.fetch(player.discordId);
      await giveWaitlistRole(member, mode);
    } catch {}
    try {
      const member = await guild.members.fetch(player.discordId);
      await member.send(
        `⏭️ Your test was skipped${reason ? ` (Reason: ${reason})` : ''}. You have been returned to the ${returnAction === 'front' ? 'front' : 'back'} of the ${mode} queue.`
      );
    } catch {}
  } else {
    try {
      const member = await guild.members.fetch(player.discordId);
      await member.send(
        `⏭️ Your test was skipped${reason ? ` (Reason: ${reason})` : ''}. You have been removed from the ${mode} queue.`
      );
    } catch {}
  }

  try {
    const cfg = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
    const channelIds = cfg?.channelIds as Record<string, string>;
    const logsChannel = guild.channels.cache.get(channelIds?.botLogs) as TextChannel | undefined;
    if (logsChannel) {
      await logsChannel.send(
        `⏭️ **Skip** — ${player.minecraftUsername} (<@${player.discordId}>) was skipped by <@${actorDiscordId}> in ${mode}. Action: \`${returnAction}\`. Reason: ${reason ?? 'None'}`
      );
    }
  } catch {}

  await sendOrUpdateWaitlistPanel(guild, mode);

  return { success: true, message: `Player skipped. Return action: \`${returnAction}\`.` };
}

// ─── Set tester available ─────────────────────────────────────────────────────
export async function setTesterAvailable(
  guild: Guild,
  testerDiscordId: string,
  mode: Mode
): Promise<{ success: boolean; message: string }> {

  await prisma.tester.upsert({
    where: { discordId: testerDiscordId },
    update: { active: true, activeMode: mode, startedAt: new Date(), lastActiveAt: new Date(), guildId: guild.id },
    create: { discordId: testerDiscordId, guildId: guild.id, active: true, activeMode: mode, startedAt: new Date(), lastActiveAt: new Date() },
  });

  await sendOrUpdateWaitlistPanel(guild, mode);

  return { success: true, message: `✅ You are now marked as available for **${mode}**. You will not automatically pull the first player in queue, you can use \`/next\` to pull when you are ready.` };
}

// ─── Reset all testers ────────────────────────────────────────────────────────
export async function resetAllTesters(guild: Guild): Promise<{ success: boolean; message: string }> {
  const activeModesData = await prisma.tester.findMany({
    where: { guildId: guild.id, active: true, activeMode: { not: null } },
    select: { activeMode: true },
    distinct: ['activeMode']
  });

  const activeModes = activeModesData.map(m => m.activeMode as Mode);

  await prisma.tester.updateMany({
    where: { guildId: guild.id, active: true },
    data: { active: false, activeMode: null, activeRegion: null },
  });

  for (const mode of activeModes) {
    try {
      await pingTestingClosed(guild, mode, 'Tier Testing Closed');
    } catch (e) {
      console.error(`Failed to ping testing closed for ${mode} during reset:`, e);
    }
  }

  await sendOrUpdateAllWaitlistPanels(guild);

  return { success: true, message: 'All testers have been successfully reset and panels updated.' };
}
