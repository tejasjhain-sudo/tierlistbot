import { PrismaClient as PostgresClient } from '@prisma/client';
import { execSync } from 'child_process';
import path from 'path';

const postgres = new PostgresClient();
const sqliteDbPath = path.resolve(__dirname, '../../prisma/database.db');

function querySqlite(sql: string): any[] {
  try {
    const raw = execSync(`sqlite3 "${sqliteDbPath}" -json "${sql}"`, { maxBuffer: 50 * 1024 * 1024 }).toString().trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e: any) {
    console.error('SQLite query failed:', e.message);
    return [];
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function migrate() {
  console.log('🚀 Fast Batch Migration from local SQLite to new Supabase PostgreSQL...');

  // 1. Players
  const players = querySqlite('SELECT * FROM Player');
  console.log(`📥 Migrating ${players.length} Players in batch...`);
  const formattedPlayers = players.map(p => ({
    id: p.id,
    discordId: p.discordId,
    minecraftUsername: p.minecraftUsername,
    minecraftUsernameLower: p.minecraftUsernameLower,
    minecraftUuid: p.minecraftUuid || null,
    region: p.region,
    preferredMode: p.preferredMode,
    registeredAt: p.registeredAt ? new Date(p.registeredAt) : new Date(),
    updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
    isBanned: Boolean(p.isBanned),
    banReason: p.banReason || null,
    waitlistRoleCooldowns: p.waitlistRoleCooldowns ? JSON.parse(p.waitlistRoleCooldowns) : null,
    lastIgnUpdateAt: p.lastIgnUpdateAt ? new Date(p.lastIgnUpdateAt) : null,
    discordAccessToken: p.discordAccessToken || null,
    discordRefreshToken: p.discordRefreshToken || null,
    discordTokenExpiresAt: p.discordTokenExpiresAt ? new Date(p.discordTokenExpiresAt) : null,
  }));

  for (const chunk of chunkArray(formattedPlayers, 100)) {
    await postgres.player.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ Players migrated!`);

  // 2. PlayerTier
  const tiers = querySqlite('SELECT * FROM PlayerTier');
  console.log(`📥 Migrating ${tiers.length} PlayerTiers in batch...`);
  const formattedTiers = tiers.map(t => ({
    id: t.id,
    playerId: t.playerId,
    mode: t.mode,
    currentTier: t.currentTier,
    previousTier: t.previousTier || null,
    lastTesterDiscordId: t.lastTesterDiscordId || null,
    lastTestedAt: t.lastTestedAt ? new Date(t.lastTestedAt) : null,
    updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
  }));

  for (const chunk of chunkArray(formattedTiers, 100)) {
    await postgres.playerTier.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ PlayerTiers migrated!`);

  // 3. TierHistory
  const history = querySqlite('SELECT * FROM TierHistory');
  console.log(`📥 Migrating ${history.length} TierHistory records in batch...`);
  const formattedHistory = history.map(h => ({
    id: h.id,
    playerId: h.playerId,
    testerDiscordId: h.testerDiscordId,
    guildId: h.guildId,
    mode: h.mode,
    region: h.region,
    previousTier: h.previousTier,
    earnedTier: h.earnedTier,
    notes: h.notes || null,
    evidenceUrl: h.evidenceUrl || null,
    sessionId: h.sessionId || null,
    createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
  }));

  for (const chunk of chunkArray(formattedHistory, 100)) {
    await postgres.tierHistory.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ TierHistory migrated!`);

  // 4. TestSession
  const sessions = querySqlite('SELECT * FROM TestSession');
  console.log(`📥 Migrating ${sessions.length} TestSessions in batch...`);
  const formattedSessions = sessions.map(s => ({
    id: s.id,
    guildId: s.guildId,
    playerId: s.playerId,
    testerDiscordId: s.testerDiscordId || null,
    mode: s.mode,
    region: s.region,
    ticketChannelId: s.ticketChannelId || null,
    status: s.status,
    previousTier: s.previousTier || null,
    earnedTier: s.earnedTier || null,
    notes: s.notes || null,
    evidenceUrl: s.evidenceUrl || null,
    startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
    completedAt: s.completedAt ? new Date(s.completedAt) : null,
    skippedAt: s.skippedAt ? new Date(s.skippedAt) : null,
    skipReason: s.skipReason || null,
    cancelledAt: s.cancelledAt ? new Date(s.cancelledAt) : null,
  }));

  for (const chunk of chunkArray(formattedSessions, 100)) {
    await postgres.testSession.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ TestSessions migrated!`);

  // 5. VerificationSession
  const verifications = querySqlite('SELECT * FROM VerificationSession');
  console.log(`📥 Migrating ${verifications.length} VerificationSessions in batch...`);
  const formattedVerifications = verifications.map(v => ({
    id: v.id,
    discordId: v.discordId,
    token: v.token,
    status: v.status,
    expiresAt: v.expiresAt ? new Date(v.expiresAt) : new Date(),
    verifiedAt: v.verifiedAt ? new Date(v.verifiedAt) : null,
    minecraftUuid: v.minecraftUuid || null,
    minecraftUsername: v.minecraftUsername || null,
    createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
  }));

  for (const chunk of chunkArray(formattedVerifications, 100)) {
    await postgres.verificationSession.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ VerificationSessions migrated!`);

  // 6. Tester
  const testers = querySqlite('SELECT * FROM Tester');
  console.log(`📥 Migrating ${testers.length} Testers in batch...`);
  const formattedTesters = testers.map(t => ({
    id: t.id,
    discordId: t.discordId,
    guildId: t.guildId,
    active: Boolean(t.active),
    activeMode: t.activeMode || null,
    activeRegion: t.activeRegion || null,
    startedAt: t.startedAt ? new Date(t.startedAt) : null,
    lastActiveAt: t.lastActiveAt ? new Date(t.lastActiveAt) : null,
  }));

  for (const chunk of chunkArray(formattedTesters, 100)) {
    await postgres.tester.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`✅ Testers migrated!`);

  // 7. GuildConfig
  const guildConfigs = querySqlite('SELECT * FROM GuildConfig');
  for (const gc of guildConfigs) {
    try {
      await postgres.guildConfig.upsert({
        where: { guildId: gc.guildId },
        update: {
          categoryIds: gc.categoryIds ? JSON.parse(gc.categoryIds) : null,
          channelIds: gc.channelIds ? JSON.parse(gc.channelIds) : null,
          roleIds: gc.roleIds ? JSON.parse(gc.roleIds) : null,
          panelMessageIds: gc.panelMessageIds ? JSON.parse(gc.panelMessageIds) : null,
          settings: gc.settings ? JSON.parse(gc.settings) : null,
        },
        create: {
          id: gc.id,
          guildId: gc.guildId,
          categoryIds: gc.categoryIds ? JSON.parse(gc.categoryIds) : null,
          channelIds: gc.channelIds ? JSON.parse(gc.channelIds) : null,
          roleIds: gc.roleIds ? JSON.parse(gc.roleIds) : null,
          panelMessageIds: gc.panelMessageIds ? JSON.parse(gc.panelMessageIds) : null,
          settings: gc.settings ? JSON.parse(gc.settings) : null,
        },
      });
    } catch (e: any) {}
  }
  console.log(`✅ GuildConfig migrated!`);

  await postgres.$disconnect();
  console.log('\n🎉 ALL DATA HAS BEEN FULLY MIGRATED TO YOUR NEW SUPABASE POSTGRESQL DATABASE!');
}

migrate().catch(console.error);
