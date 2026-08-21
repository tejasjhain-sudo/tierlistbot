import { Router, Request, Response } from 'express';
import { Mode, Region } from '../../config/constants';
import { getLeaderboard } from '../../services/tierService';

const router = Router();

const VALID_MODES = ['sword', 'axe', 'nethpot', 'dpot', 'uhc', 'smp', 'crystal', 'mace'];

// GET /api/leaderboard/:mode
router.get('/:mode', async (req: Request, res: Response) => {
  try {
    const rawMode = Array.isArray(req.params.mode) ? req.params.mode[0] : req.params.mode;
    const mode = (rawMode || '').toLowerCase() as Mode;
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Valid modes are: ${VALID_MODES.join(', ')}` });
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const result = await getLeaderboard(mode, undefined, page, limit);

    res.json({
      mode,
      data: result.entries.map((e, i) => ({
        rank: (page - 1) * limit + i + 1,
        minecraftUsername: e.player.minecraftUsername,
        discordId: e.player.discordId,
        region: e.player.region,
        tier: e.currentTier,
        lastTestedAt: e.lastTestedAt,
      })),
      pagination: { page, limit, total: result.total, pages: result.pages },
    });
  } catch (err: any) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/leaderboard/:mode/:region
router.get('/:mode/:region', async (req: Request, res: Response) => {
  try {
    const rawMode = Array.isArray(req.params.mode) ? req.params.mode[0] : req.params.mode;
    const mode = (rawMode || '').toLowerCase() as Mode;
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Valid modes are: ${VALID_MODES.join(', ')}` });
    }
    const rawRegion = Array.isArray(req.params.region) ? req.params.region[0] : req.params.region;
    const region = (rawRegion || '').toUpperCase() as Region;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const result = await getLeaderboard(mode, region, page, limit);

    res.json({
      mode,
      region,
      data: result.entries.map((e, i) => ({
        rank: (page - 1) * limit + i + 1,
        minecraftUsername: e.player.minecraftUsername,
        discordId: e.player.discordId,
        region: e.player.region,
        tier: e.currentTier,
        lastTestedAt: e.lastTestedAt,
      })),
      pagination: { page, limit, total: result.total, pages: result.pages },
    });
  } catch (err: any) {
    console.error('Error fetching region leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

export default router;
