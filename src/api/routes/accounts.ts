import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { unlinkAccount } from '../../services/verificationService';
import prisma from '../../database/prisma';

const router = Router();

function validateApiSecret(req: Request, res: Response, next: () => void): any {
  const apiKey = req.headers['x-api-secret'] || req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedSecret = config.apiSecret || process.env.API_SECRET || 'rearmc-verify-secret';

  if (!apiKey || apiKey !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API secret' });
  }
  next();
}

// ─── POST /api/accounts/unlink ──────────────────────────────────────────────
router.post('/unlink', validateApiSecret, async (req: Request, res: Response): Promise<any> => {
  const { discord_id } = req.body;
  if (!discord_id) {
    return res.status(400).json({ error: 'Missing discord_id parameter.' });
  }

  try {
    const result = await unlinkAccount(discord_id);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    return res.json({ success: true, message: result.message });
  } catch (error) {
    console.error('Error unlinking account:', error);
    return res.status(500).json({ error: 'Failed to unlink account.' });
  }
});

// ─── GET /api/accounts/:discordId ───────────────────────────────────────────
router.get('/:discordId', async (req: Request, res: Response): Promise<any> => {
  const discordId = Array.isArray(req.params.discordId) ? req.params.discordId[0] : req.params.discordId;

  try {
    const player = await prisma.player.findUnique({
      where: { discordId },
      include: {
        tiers: true,
        tierHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!player) {
      return res.status(404).json({ error: 'Account not found or unverified.' });
    }

    return res.json(player);
  } catch (error) {
    console.error('Error fetching account by Discord ID:', error);
    return res.status(500).json({ error: 'Failed to fetch account.' });
  }
});

// ─── GET /api/accounts/minecraft/:uuid ──────────────────────────────────────
router.get('/minecraft/:uuid', async (req: Request, res: Response): Promise<any> => {
  const uuid = Array.isArray(req.params.uuid) ? req.params.uuid[0] : req.params.uuid;

  try {
    const player = await prisma.player.findFirst({
      where: { minecraftUuid: uuid },
      include: {
        tiers: true,
        tierHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!player) {
      return res.status(404).json({ error: 'Minecraft UUID not found or unverified.' });
    }

    return res.json(player);
  } catch (error) {
    console.error('Error fetching account by Minecraft UUID:', error);
    return res.status(500).json({ error: 'Failed to fetch account.' });
  }
});

export default router;
