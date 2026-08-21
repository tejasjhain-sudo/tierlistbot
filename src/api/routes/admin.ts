import { Router, Request, Response } from 'express';
import { Mode, Region, Tier } from '../../config/constants';
import prisma from '../../database/prisma';
import { requireApiKey } from '../middleware/auth';

const router = Router();
router.use(requireApiKey);

// POST /api/admin/players/:id/tier
router.post('/players/:id/tier', async (req: Request, res: Response) => {
  const { mode, tier } = req.body as { mode: Mode; tier: Tier };
  if (!mode || !tier) return res.status(400).json({ error: 'mode and tier are required' });

  const player = await prisma.player.findUnique({ where: { discordId: req.params.id as string } });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  await prisma.playerTier.upsert({
    where: { playerId_mode: { playerId: player.id, mode } },
    update: { currentTier: tier, lastTestedAt: new Date() },
    create: { playerId: player.id, mode, currentTier: tier, lastTestedAt: new Date() },
  });

  res.json({ success: true, message: `Set ${player.minecraftUsername}'s ${mode} tier to ${tier}` });
});

// DELETE /api/admin/players/:id/tier
router.delete('/players/:id/tier', async (req: Request, res: Response) => {
  const { mode } = req.body as { mode: Mode };
  if (!mode) return res.status(400).json({ error: 'mode is required' });

  const player = await prisma.player.findUnique({ where: { discordId: req.params.id as string } });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  await prisma.playerTier.deleteMany({ where: { playerId: player.id, mode } });
  res.json({ success: true });
});

// POST /api/admin/queue
router.post('/queue', async (req: Request, res: Response) => {
  const { discordId, mode, region, guildId } = req.body as { discordId: string; mode: Mode; region: Region; guildId: string };
  if (!discordId || !mode || !region || !guildId) return res.status(400).json({ error: 'Missing fields' });

  const player = await prisma.player.findUnique({ where: { discordId } });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const entry = await prisma.queueEntry.create({
    data: { playerId: player.id, guildId, mode, region, status: 'WAITING' },
  });
  res.json({ success: true, entryId: entry.id });
});

// DELETE /api/admin/queue/:entryId
router.delete('/queue/:entryId', async (req: Request, res: Response) => {
  await prisma.queueEntry.delete({ where: { id: req.params.entryId as string } }).catch(() => {});
  res.json({ success: true });
});

// GET /api/admin/sessions
router.get('/sessions', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const sessions = await prisma.testSession.findMany({
    where: status ? { status: status as any } : {},
    include: { player: true },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json({ data: sessions });
});

// POST /api/admin/sessions/:id/complete
router.post('/sessions/:id/complete', async (req: Request, res: Response) => {
  const { earnedTier, notes, evidenceUrl } = req.body;
  if (!earnedTier) return res.status(400).json({ error: 'earnedTier is required' });

  const session = await prisma.testSession.findUnique({ where: { id: req.params.id as string } });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  await prisma.testSession.update({
    where: { id: req.params.id as string },
    data: { status: 'COMPLETED', earnedTier, notes, evidenceUrl, completedAt: new Date() },
  });

  res.json({ success: true });
});

// POST /api/admin/sessions/:id/cancel
router.post('/sessions/:id/cancel', async (_req: Request, res: Response) => {
  await prisma.testSession.update({
    where: { id: _req.params.id as string },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  res.json({ success: true });
});

export default router;
