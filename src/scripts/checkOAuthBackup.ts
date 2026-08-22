import prisma from '../database/prisma';

async function checkOAuthBackup() {
  console.log('🔍 Checking OAuth Backup Registrations in Supabase PostgreSQL...\n');

  const totalPlayers = await prisma.player.count();
  const oauthPlayers = await prisma.player.findMany({
    where: {
      discordAccessToken: { not: null },
    },
    select: {
      id: true,
      discordId: true,
      minecraftUsername: true,
      region: true,
      discordTokenExpiresAt: true,
      registeredAt: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  console.log(`📊 TOTAL PLAYERS IN DATABASE: ${totalPlayers}`);
  console.log(`🔒 PLAYERS WITH OAUTH BACKUP TOKEN: ${oauthPlayers.length}\n`);

  if (oauthPlayers.length > 0) {
    console.log('--- OAUTH AUTHORIZED MEMBERS ---');
    oauthPlayers.forEach((p, idx) => {
      console.log(
        `${idx + 1}. Discord ID: ${p.discordId} | IGN: ${p.minecraftUsername || 'N/A'} | Region: ${p.region} | Expires: ${p.discordTokenExpiresAt?.toISOString() || 'Never'}`
      );
    });
  } else {
    console.log('No members have authorized with OAuth backup yet.');
  }

  await prisma.$disconnect();
}

checkOAuthBackup().catch(console.error);
