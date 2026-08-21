import { Router, Request, Response } from 'express';
import prisma from '../../database/prisma';

const router = Router();

// GET /api/stats
router.get('/', async (_req: Request, res: Response) => {
  const [totalPlayers, totalTests, activeSessions, activeTesters] = await Promise.all([
    prisma.player.count(),
    prisma.tierHistory.count(),
    prisma.testSession.count({ where: { status: 'ACTIVE' } }),
    prisma.tester.count({ where: { active: true } }),
  ]);

  // Queue totals per mode
  const queueStats = await prisma.queueEntry.groupBy({
    by: ['mode'],
    where: { status: 'WAITING' },
    _count: { id: true },
  });

  const queues: Record<string, number> = {};
  for (const q of queueStats) {
    queues[q.mode] = q._count.id;
  }

  res.json({
    totalPlayers,
    totalTests,
    activeSessions,
    activeTesters,
    queues,
    timestamp: new Date().toISOString(),
  });
});

export default router;
