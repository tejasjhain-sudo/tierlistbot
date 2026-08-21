import prisma from '../database/prisma';
import { Prisma } from '@prisma/client';

async function resetSeason() {
  console.log('🔄 Starting New Season Reset in Supabase PostgreSQL...');

  // 1. Reset all PlayerTier records to 'Unranked' and clear previous tiers
  const updatedTiers = await prisma.playerTier.updateMany({
    data: {
      currentTier: 'Unranked',
      previousTier: null,
      lastTesterDiscordId: null,
      lastTestedAt: null,
    },
  });
  console.log(`✅ Reset ${updatedTiers.count} PlayerTier records to 'Unranked' with null previous tiers.`);

  // 2. Clear old TierHistory records for the fresh season
  const deletedHistory = await prisma.tierHistory.deleteMany({});
  console.log(`✅ Cleared ${deletedHistory.count} old TierHistory logs for the new season.`);

  // 3. Clear old TestSession records
  const deletedSessions = await prisma.testSession.deleteMany({});
  console.log(`✅ Cleared ${deletedSessions.count} old TestSession logs.`);

  // 4. Reset player waitlist cooldowns so everyone can join testing immediately
  const updatedPlayers = await prisma.player.updateMany({
    data: {
      waitlistRoleCooldowns: Prisma.DbNull,
    },
  });
  console.log(`✅ Reset cooldowns for ${updatedPlayers.count} players.`);

  console.log('\n🏆 NEW SEASON RESET COMPLETE! All players are now Unranked with 0 previous rank.');
}

resetSeason()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
