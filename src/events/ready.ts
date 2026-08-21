import { Client, Guild, ActivityType } from 'discord.js';
import prisma from '../database/prisma';
import { sendOrUpdateRegistrationPanel, sendOrUpdateAllWaitlistPanels } from '../services/panelService';
import { stopTesting } from '../services/testerService';
import { SessionStatus } from '../config/constants';

export async function handleReady(client: Client): Promise<void> {
  console.log(`✅ Bot ready as ${client.user?.tag}`);

  client.user?.setPresence({
    status: 'online',
    activities: [{
      name: 'RearMC | /apply',
      type: ActivityType.Playing,
    }],
  });

  for (const [, guild] of client.guilds.cache) {
    await restoreGuild(guild);
  }


  // Auto-close AFK queues (1 hour of inactivity)
  setInterval(async () => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const afkTesters = await prisma.tester.findMany({
        where: {
          active: true,
          OR: [
            { lastActiveAt: { lt: oneHourAgo } },
            { lastActiveAt: null, startedAt: { lt: oneHourAgo } }
          ]
        }
      });

      for (const tester of afkTesters) {
        const guild = client.guilds.cache.get(tester.guildId);
        if (!guild) continue;

        console.log(`[Auto-Close] Closing AFK queue for tester ${tester.discordId}`);
        await stopTesting(guild, tester.discordId, 'Closed due to 1 hour of inactivity');
        
        try {
          const user = await client.users.fetch(tester.discordId);
          await user.send(`💤 Your Tier Testing queue for **${tester.activeMode}** was automatically closed because you were AFK for 1 hour without pulling any players.`);
        } catch (err) {
          // Ignore if DMs are closed
        }
      }
    } catch (err) {
      console.error('Error in AFK queue auto-close interval:', err);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
};

async function restoreGuild(guild: Guild) {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  if (!guildConfig) return;

  console.log(`[${guild.name}] Restoring state...`);

  // Wait a few seconds for Discord's cache to populate before restoring panels.
  // This prevents false "Unknown Message" errors that would cause duplicate panels to be sent.
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Restore panels
  try {
    await sendOrUpdateRegistrationPanel(guild);
    await sendOrUpdateAllWaitlistPanels(guild);
  } catch (e) {
    console.error(`[${guild.name}] Failed to restore panels:`, e);
  }

  // Do not mark testers as inactive on restart, so testing sessions persist across bot restarts


  // Detect stale CLAIMED queue entries (from a crash during ticket creation) and reset them
  const staleClaimed = await prisma.queueEntry.findMany({
    where: { guildId: guild.id, status: 'CLAIMED' },
  });
  for (const entry of staleClaimed) {
    // Check if there's a live ACTIVE session for this player in that mode
    const session = await prisma.testSession.findFirst({
      where: { playerId: entry.playerId, mode: entry.mode, status: SessionStatus.ACTIVE },
    });
    if (!session) {
      // Reset to WAITING
      await prisma.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'WAITING', lockedAt: null, lockedByTesterId: null },
      });
    }
  }

  console.log(`[${guild.name}] State restored.`);
}
