import { Router, Request, Response } from 'express';
import { Mode } from '../../config/constants';
import prisma from '../../database/prisma';
import { MODES } from '../../config/constants';

const router = Router();

// GET /api/queues
router.get('/', async (_req: Request, res: Response) => {
  const modes = Object.keys(MODES) as Mode[];
  const result: Record<string, any> = {};

  for (const mode of modes) {
    const entries = await prisma.queueEntry.findMany({
      where: { mode, status: 'WAITING' },
      include: { player: true },
      orderBy: { joinedAt: 'asc' },
    });

    result[mode] = {
      count: entries.length,
      players: entries.map(e => ({
        minecraftUsername: e.player.minecraftUsername,
        region: e.region,
        joinedAt: e.joinedAt,
      })),
    };
  }

  res.json(result);
});

// GET /api/queues/:mode
router.get('/:mode', async (req: Request, res: Response) => {
  const mode = req.params.mode as Mode;
  const entries = await prisma.queueEntry.findMany({
    where: { mode, status: 'WAITING' },
    include: { player: true },
    orderBy: { joinedAt: 'asc' },
  });

  res.json({
    mode,
    count: entries.length,
    players: entries.map((e, i) => ({
      position: i + 1,
      minecraftUsername: e.player.minecraftUsername,
      discordId: e.player.discordId,
      region: e.region,
      joinedAt: e.joinedAt,
    })),
  });
});

export default router;
