import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import prisma from '../database/prisma';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gioxgsgiihqtbtbljnil.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_nQlLJaj1mr2XdhA7YZFl2w_0_hGf_57';

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncTable<T>(tableName: string, fetchFn: () => Promise<any[]>, upsertFn: (records: any[]) => Promise<void>) {
  try {
    console.log(`⏳ Fetching ${tableName} from Supabase...`);
    const records = await fetchFn();
    console.log(`📥 Downloaded ${records.length} ${tableName} records. Syncing to local SQLite...`);
    await upsertFn(records);
    console.log(`✅ Synced ${records.length} ${tableName} records successfully!`);
  } catch (err: any) {
    console.error(`❌ Error syncing ${tableName}:`, err.message || err);
  }
}

async function fetchAllRows(tableName: string): Promise<any[]> {
  const pageSize = 1000;
  let allRows: any[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allRows = allRows.concat(data);
    if (data.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRows;
}

export async function syncAllDataFromSupabase() {
  console.log('🚀 Starting Full Database Sync from Supabase to Local SQLite (database.db)...\n');

  // 1. Players
  await syncTable('Player', () => fetchAllRows('Player'), async (players) => {
    for (const p of players) {
      await prisma.player.upsert({
        where: { discordId: p.discordId },
        update: {
          id: p.id,
          minecraftUsername: p.minecraftUsername,
          minecraftUsernameLower: p.minecraftUsernameLower,
          minecraftUuid: p.minecraftUuid,
          region: p.region,
          preferredMode: p.preferredMode,
          registeredAt: p.registeredAt ? new Date(p.registeredAt) : new Date(),
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
          isBanned: p.isBanned ?? false,
          banReason: p.banReason,
          waitlistRoleCooldowns: p.waitlistRoleCooldowns,
          lastIgnUpdateAt: p.lastIgnUpdateAt ? new Date(p.lastIgnUpdateAt) : null,
          discordAccessToken: p.discordAccessToken,
          discordRefreshToken: p.discordRefreshToken,
          discordTokenExpiresAt: p.discordTokenExpiresAt ? new Date(p.discordTokenExpiresAt) : null,
        },
        create: {
          id: p.id,
          discordId: p.discordId,
          minecraftUsername: p.minecraftUsername,
          minecraftUsernameLower: p.minecraftUsernameLower,
          minecraftUuid: p.minecraftUuid,
          region: p.region,
          preferredMode: p.preferredMode,
          registeredAt: p.registeredAt ? new Date(p.registeredAt) : new Date(),
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
          isBanned: p.isBanned ?? false,
          banReason: p.banReason,
          waitlistRoleCooldowns: p.waitlistRoleCooldowns,
          lastIgnUpdateAt: p.lastIgnUpdateAt ? new Date(p.lastIgnUpdateAt) : null,
          discordAccessToken: p.discordAccessToken,
          discordRefreshToken: p.discordRefreshToken,
          discordTokenExpiresAt: p.discordTokenExpiresAt ? new Date(p.discordTokenExpiresAt) : null,
        },
      });
    }
  });

  // 2. PlayerTier
  await syncTable('PlayerTier', () => fetchAllRows('PlayerTier'), async (tiers) => {
    for (const t of tiers) {
      await prisma.playerTier.upsert({
        where: { id: t.id },
        update: {
          playerId: t.playerId,
          mode: t.mode,
          currentTier: t.currentTier,
          previousTier: t.previousTier,
          lastTesterDiscordId: t.lastTesterDiscordId,
          lastTestedAt: t.lastTestedAt ? new Date(t.lastTestedAt) : null,
          updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
        },
        create: {
          id: t.id,
          playerId: t.playerId,
          mode: t.mode,
          currentTier: t.currentTier,
          previousTier: t.previousTier,
          lastTesterDiscordId: t.lastTesterDiscordId,
          lastTestedAt: t.lastTestedAt ? new Date(t.lastTestedAt) : null,
          updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
        },
      });
    }
  });

  // 3. TierHistory
  await syncTable('TierHistory', () => fetchAllRows('TierHistory'), async (history) => {
    for (const h of history) {
      await prisma.tierHistory.upsert({
        where: { id: h.id },
        update: {
          playerId: h.playerId,
          testerDiscordId: h.testerDiscordId,
          guildId: h.guildId,
          mode: h.mode,
          region: h.region,
          previousTier: h.previousTier,
          earnedTier: h.earnedTier,
          notes: h.notes,
          evidenceUrl: h.evidenceUrl,
          sessionId: h.sessionId,
          createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
        },
        create: {
          id: h.id,
          playerId: h.playerId,
          testerDiscordId: h.testerDiscordId,
          guildId: h.guildId,
          mode: h.mode,
          region: h.region,
          previousTier: h.previousTier,
          earnedTier: h.earnedTier,
          notes: h.notes,
          evidenceUrl: h.evidenceUrl,
          sessionId: h.sessionId,
          createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
        },
      });
    }
  });

  // 4. TestSession
  await syncTable('TestSession', () => fetchAllRows('TestSession'), async (sessions) => {
    for (const s of sessions) {
      await prisma.testSession.upsert({
        where: { id: s.id },
        update: {
          guildId: s.guildId,
          playerId: s.playerId,
          testerDiscordId: s.testerDiscordId,
          mode: s.mode,
          region: s.region,
          ticketChannelId: s.ticketChannelId,
          status: s.status,
          previousTier: s.previousTier,
          earnedTier: s.earnedTier,
          notes: s.notes,
          evidenceUrl: s.evidenceUrl,
          startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
          skippedAt: s.skippedAt ? new Date(s.skippedAt) : null,
          skipReason: s.skipReason,
          cancelledAt: s.cancelledAt ? new Date(s.cancelledAt) : null,
        },
        create: {
          id: s.id,
          guildId: s.guildId,
          playerId: s.playerId,
          testerDiscordId: s.testerDiscordId,
          mode: s.mode,
          region: s.region,
          ticketChannelId: s.ticketChannelId,
          status: s.status,
          previousTier: s.previousTier,
          earnedTier: s.earnedTier,
          notes: s.notes,
          evidenceUrl: s.evidenceUrl,
          startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
          completedAt: s.completedAt ? new Date(s.completedAt) : null,
          skippedAt: s.skippedAt ? new Date(s.skippedAt) : null,
          skipReason: s.skipReason,
          cancelledAt: s.cancelledAt ? new Date(s.cancelledAt) : null,
        },
      });
    }
  });

  // 5. VerificationSession
  await syncTable('VerificationSession', () => fetchAllRows('VerificationSession'), async (verifications) => {
    for (const v of verifications) {
      await prisma.verificationSession.upsert({
        where: { id: v.id },
        update: {
          discordId: v.discordId,
          token: v.token,
          status: v.status,
          expiresAt: v.expiresAt ? new Date(v.expiresAt) : new Date(),
          verifiedAt: v.verifiedAt ? new Date(v.verifiedAt) : null,
          minecraftUuid: v.minecraftUuid,
          minecraftUsername: v.minecraftUsername,
          createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
        },
        create: {
          id: v.id,
          discordId: v.discordId,
          token: v.token,
          status: v.status,
          expiresAt: v.expiresAt ? new Date(v.expiresAt) : new Date(),
          verifiedAt: v.verifiedAt ? new Date(v.verifiedAt) : null,
          minecraftUuid: v.minecraftUuid,
          minecraftUsername: v.minecraftUsername,
          createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
        },
      });
    }
  });

  // 6. Tester
  await syncTable('Tester', () => fetchAllRows('Tester'), async (testers) => {
    for (const t of testers) {
      await prisma.tester.upsert({
        where: { discordId: t.discordId },
        update: {
          guildId: t.guildId,
          active: t.active ?? false,
          activeMode: t.activeMode,
          activeRegion: t.activeRegion,
          startedAt: t.startedAt ? new Date(t.startedAt) : null,
          lastActiveAt: t.lastActiveAt ? new Date(t.lastActiveAt) : null,
        },
        create: {
          id: t.id,
          discordId: t.discordId,
          guildId: t.guildId,
          active: t.active ?? false,
          activeMode: t.activeMode,
          activeRegion: t.activeRegion,
          startedAt: t.startedAt ? new Date(t.startedAt) : null,
          lastActiveAt: t.lastActiveAt ? new Date(t.lastActiveAt) : null,
        },
      });
    }
  });

  console.log('\n🎉 ALL SUPABASE DATA SYNCED TO LOCAL SQLITE DATABASE SUCCESSFULLY!');
}

syncAllDataFromSupabase()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
