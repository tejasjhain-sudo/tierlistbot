import prisma from '../database/prisma';
import { execSync } from 'child_process';
import path from 'path';

async function syncTokens() {
  console.log('🔄 Syncing OAuth tokens from SQLite to Supabase PostgreSQL...');

  const dbPath = path.resolve(__dirname, '../../prisma/database.db');
  const rawJson = execSync(
    `sqlite3 "${dbPath}" ".mode json" "SELECT discordId, discordAccessToken, discordRefreshToken, discordTokenExpiresAt FROM Player WHERE discordAccessToken IS NOT NULL;"`,
    { encoding: 'utf8' }
  );

  const sqlitePlayersWithTokens = JSON.parse(rawJson);
  console.log(`Found ${sqlitePlayersWithTokens.length} OAuth tokens in SQLite.`);

  let synced = 0;
  for (const sp of sqlitePlayersWithTokens) {
    let expiresAt: Date | null = null;
    if (sp.discordTokenExpiresAt) {
      const num = Number(sp.discordTokenExpiresAt);
      expiresAt = !isNaN(num) ? new Date(num) : new Date(sp.discordTokenExpiresAt);
    }

    try {
      await prisma.player.upsert({
        where: { discordId: sp.discordId },
        update: {
          discordAccessToken: sp.discordAccessToken,
          discordRefreshToken: sp.discordRefreshToken,
          discordTokenExpiresAt: expiresAt,
        },
        create: {
          discordId: sp.discordId,
          minecraftUsername: `User_${sp.discordId.slice(-4)}`,
          minecraftUsernameLower: `user_${sp.discordId.slice(-4)}`,
          region: 'AS',
          preferredMode: 'sword',
          discordAccessToken: sp.discordAccessToken,
          discordRefreshToken: sp.discordRefreshToken,
          discordTokenExpiresAt: expiresAt,
        },
      });
      synced++;
    } catch (e: any) {
      console.error(`Failed to sync token for ${sp.discordId}:`, e.message);
    }
  }

  console.log(`✅ Successfully synced ${synced}/${sqlitePlayersWithTokens.length} OAuth tokens into Supabase PostgreSQL!`);
  await prisma.$disconnect();
}

syncTokens().catch(console.error);
