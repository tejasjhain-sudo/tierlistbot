import { Router, Request, Response } from 'express';
import prisma from '../../database/prisma';
import { Mode, Region, Tier } from '../../config/constants';
import { MODES } from '../../config/constants';

const router = Router();

// ─── GET /api/players ─────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const search = (req.query.search as string)?.toLowerCase();
  const region = req.query.region as Region | undefined;
  const mode = req.query.mode as Mode | undefined;
  const tier = req.query.tier as Tier | undefined;

  const where: any = {};
  if (search) where.minecraftUsernameLower = { contains: search };
  if (region) where.region = region;

  if (mode && tier) {
    where.tiers = { some: { mode, currentTier: tier } };
  } else if (mode) {
    where.tiers = { some: { mode } };
  }

  const [players, total] = await Promise.all([
    prisma.player.findMany({
      where,
      include: {
        tiers: true,
        tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { registeredAt: 'desc' },
    }),
    prisma.player.count({ where }),
  ]);

  res.json({
    data: players.map(formatPlayer),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ─── GET /api/players/:minecraftUsername ─────────────────────────────────────
router.get('/:minecraftUsername', async (req: Request, res: Response) => {
  const player = await prisma.player.findUnique({
    where: { minecraftUsernameLower: (req.params.minecraftUsername as string).toLowerCase() },
    include: { tiers: true, tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(formatPlayer(player));
});

// ─── GET /api/players/discord/:discordId ─────────────────────────────────────
router.get('/discord/:discordId', async (req: Request, res: Response) => {
  const player = await prisma.player.findUnique({
    where: { discordId: req.params.discordId as string },
    include: { tiers: true, tierHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(formatPlayer(player));
});

// ─── GET /api/history/:minecraftUsername ─────────────────────────────────────
router.get('/history/:minecraftUsername', async (req: Request, res: Response) => {
  const player = await prisma.player.findUnique({
    where: { minecraftUsernameLower: (req.params.minecraftUsername as string).toLowerCase() },
  });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 10);

  const [entries, total] = await Promise.all([
    prisma.tierHistory.findMany({
      where: { playerId: player.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tierHistory.count({ where: { playerId: player.id } }),
  ]);

  res.json({
    data: entries.map(e => ({
      id: e.id,
      mode: e.mode,
      region: e.region,
      previousTier: e.previousTier,
      earnedTier: e.earnedTier,
      testerDiscordId: e.testerDiscordId,
      evidenceUrl: e.evidenceUrl,
      testedAt: e.createdAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ─── Formatter ────────────────────────────────────────────────────────────────
function formatPlayer(player: any) {
  const tiers: Record<string, string | null> = {};
  for (const mode of Object.keys(MODES)) {
    const tierEntry = player.tiers.find((t: any) => t.mode === mode);
    tiers[mode] = tierEntry?.currentTier ?? null;
  }
  const latest = player.tierHistory?.[0];
  return {
    discordId: player.discordId,
    minecraftUsername: player.minecraftUsername,
    minecraftUuid: player.minecraftUuid,
    region: player.region,
    registeredAt: player.registeredAt,
    tiers,
    totalTests: player.tierHistory?.length ?? 0,
    latestTest: latest
      ? {
          mode: latest.mode,
          previousTier: latest.previousTier,
          earnedTier: latest.earnedTier,
          testerDiscordId: latest.testerDiscordId,
          testedAt: latest.createdAt,
        }
      : null,
  };
}

// ─── GET /api/players/tiers/all ──────────────────────────────────────────────
router.get('/tiers/all', async (req: Request, res: Response) => {
  const allPlayers = await prisma.player.findMany({
    include: { tiers: true },
  });

  const result: Record<string, Record<string, string | null>> = {};

  for (const player of allPlayers) {
    const tiers: Record<string, string | null> = {};
    for (const mode of Object.keys(MODES)) {
      const tierEntry = player.tiers.find((t: any) => t.mode === mode);
      tiers[mode] = tierEntry?.currentTier ?? null;
    }
    result[player.minecraftUsername] = tiers;
  }

  res.json(result);
});

export default router;
