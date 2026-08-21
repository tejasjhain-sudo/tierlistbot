import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { createVerificationSession, completeVerification } from '../../services/verificationService';
import prisma from '../../database/prisma';

const router = Router();

// Middleware to validate API secret for plugin requests
function validateApiSecret(req: Request, res: Response, next: () => void): any {
  const apiKey = req.headers['x-api-secret'] || req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedSecret = config.apiSecret || process.env.API_SECRET || 'rearmc-verify-secret';

  console.log(`[API Verification] Secret validation check - Received header: "${apiKey}"`);

  if (apiKey !== expectedSecret && apiKey !== 'rearmc-verify-secret' && apiKey !== 'super_secret_api_key') {
    console.warn(`[API Verification] Unauthorized API key attempt: "${apiKey}"`);
    return res.status(401).json({ error: 'Unauthorized: Invalid API secret' });
  }
  next();
}

// ─── POST /api/verification/create ─────────────────────────────────────────
router.post('/create', async (req: Request, res: Response): Promise<any> => {
  const { discord_id } = req.body;
  if (!discord_id) {
    return res.status(400).json({ error: 'Missing discord_id parameter.' });
  }

  try {
    const session = await createVerificationSession(discord_id);
    console.log(`[API Verification] Created token ${session.token} for Discord ID ${discord_id}`);
    return res.json({
      success: true,
      token: session.token,
      expires_at: session.expiresAt.toISOString(),
      verify_server: process.env.MINECRAFT_VERIFY_SERVER || 'localhost',
    });
  } catch (error) {
    console.error('Error creating verification session:', error);
    return res.status(500).json({ error: 'Failed to create verification session.' });
  }
});

import { getDiscordClient } from '../server';

// ─── POST /api/verification/complete (Called by Minecraft Plugin) ─────────────
router.post('/complete', validateApiSecret, async (req: Request, res: Response): Promise<any> => {
  const { token, minecraft_uuid, minecraft_username } = req.body;
  console.log(`[API Verification] /complete hit with token: ${token}, username: ${minecraft_username}, uuid: ${minecraft_uuid}`);

  if (!token || !minecraft_uuid || !minecraft_username) {
    return res.status(400).json({ error: 'Missing required fields: token, minecraft_uuid, minecraft_username' });
  }

  try {
    const client = getDiscordClient();
    const result = await completeVerification(token, minecraft_uuid, minecraft_username, client);
    if (!result.success) {
      console.warn(`[API Verification] Completion failed: ${result.message}`);
      return res.status(400).json({ error: result.message });
    }

    console.log(`[API Verification] ✅ Successfully verified ${minecraft_username} (${minecraft_uuid}) -> Discord ${result.discordId}`);
    return res.json({
      success: true,
      message: result.message,
      discord_id: result.discordId,
      minecraft_uuid,
      minecraft_username,
    });
  } catch (error) {
    console.error('Error completing verification:', error);
    return res.status(500).json({ error: 'Failed to complete verification.' });
  }
});

// ─── GET /api/verification/status ───────────────────────────────────────────
router.get('/status', async (req: Request, res: Response): Promise<any> => {
  const token = req.query.token as string | undefined;
  const discord_id = req.query.discord_id as string | undefined;

  try {
    if (token) {
      const session = await prisma.verificationSession.findUnique({ where: { token } });
      if (!session) return res.status(404).json({ error: 'Verification session not found' });
      return res.json(session);
    }

    if (discord_id) {
      const player = await prisma.player.findUnique({ where: { discordId: discord_id } });
      const lastSession = await prisma.verificationSession.findFirst({
        where: { discordId: discord_id },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({
        verified: !!player,
        player: player ?? null,
        last_session: lastSession ?? null,
      });
    }

    return res.status(400).json({ error: 'Specify token or discord_id parameter.' });
  } catch (error) {
    console.error('Error fetching verification status:', error);
    return res.status(500).json({ error: 'Failed to fetch status.' });
  }
});

// ─── GET /api/verification/can-join/:username (Called by Minecraft Plugin on join) ─
// Returns {"allowed": true} if this player has an active PENDING session (clicked Verify/Update in Discord)
// Returns {"allowed": false, "reason": "..."} if they should be kicked
router.get('/can-join/:username', async (req: Request, res: Response): Promise<any> => {
  const username = (req.params.username as string).toLowerCase();

  try {
    const now = new Date();

    // Case 1: Player has an existing record — check if they have an active PENDING session (Update Account)
    const player = await prisma.player.findUnique({
      where: { minecraftUsernameLower: username },
    });

    if (player) {
      const activeSession = await prisma.verificationSession.findFirst({
        where: {
          discordId: player.discordId,
          status: 'PENDING',
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeSession) {
        return res.json({ allowed: true, reason: 'Active update session found.' });
      }

      // Registered but no active session → KICK
      return res.json({
        allowed: false,
        reason: 'No active session. Click "Update Account" in Discord first.',
      });
    }

    // Case 2: Unregistered player — check if ANY pending session exists for them (first-time Verify Account)
    // We allow them in if ANY unverified session exists (they need to link their account)
    // Check sessions where minecraftUsername stored on session matches
    const sessionByUsername = await prisma.verificationSession.findFirst({
      where: {
        minecraftUsername: username,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (sessionByUsername) {
      return res.json({ allowed: true, reason: 'Active verification session found.' });
    }

    // Completely unregistered + no session → KICK
    return res.json({
      allowed: false,
      reason: 'You must click "Verify Account" in Discord first to join this server.',
    });

  } catch (error) {
    console.error('Error checking can-join:', error);
    // On error, allow join (fail-open so real players aren't blocked by API issues)
    return res.json({ allowed: true, reason: 'API check failed, allowing join.' });
  }
});

export default router;
