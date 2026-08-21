import { Router, Request, Response } from 'express';
import prisma from '../../database/prisma';
import { Mode, Region } from '../../config/constants';

const router = Router();

// ─── GET /api/sessions ─────────────────────────────────────────────────────────
// Returns all completed tier test sessions with full player, tester, and result details
router.get('/', async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const mode   = req.query.mode   as Mode   | undefined;
  const region = req.query.region as Region | undefined;
  const status = (req.query.status as string)?.toUpperCase();

  const where: any = {};
  if (mode)   where.mode   = mode;
  if (region) where.region = region;
  if (status) where.status = status;

  const [sessions, total] = await Promise.all([
    prisma.testSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        player: {
          include: {
            tiers: true,
          },
        },
      },
    }),
    prisma.testSession.count({ where }),
  ]);

  res.json({
    data: sessions.map(s => ({
      sessionId:         s.id,
      status:            s.status,
      mode:              s.mode,
      region:            s.region,
      startedAt:         s.startedAt,
      completedAt:       s.completedAt,
      // Tester info
      testerDiscordId:   s.testerDiscordId,
      // Player info
      player: {
        discordId:         s.player.discordId,
        minecraftUsername: s.player.minecraftUsername,
        minecraftUuid:     s.player.minecraftUuid,
        region:            s.player.region,
        currentTiers:      Object.fromEntries(
          s.player.tiers.map(t => [t.mode, t.currentTier])
        ),
      },
      // Result
      previousTier:  s.previousTier,
      earnedTier:    s.earnedTier,
      notes:         s.notes,
      evidenceUrl:   s.evidenceUrl,
      ticketChannelId: s.ticketChannelId,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ─── GET /api/sessions/:sessionId ─────────────────────────────────────────────
router.get('/:sessionId', async (req: Request, res: Response) => {
  const session = await prisma.testSession.findUnique({
    where: { id: req.params.sessionId as string },
    include: {
      player: { include: { tiers: true, tierHistory: { orderBy: { createdAt: 'desc' } } } },
    },
  });

  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    sessionId:         session.id,
    status:            session.status,
    mode:              session.mode,
    region:            session.region,
    startedAt:         session.startedAt,
    completedAt:       session.completedAt,
    testerDiscordId:   session.testerDiscordId,
    player: {
      discordId:         session.player.discordId,
      minecraftUsername: session.player.minecraftUsername,
      minecraftUuid:     session.player.minecraftUuid,
      region:            session.player.region,
      currentTiers:      Object.fromEntries(
        session.player.tiers.map(t => [t.mode, t.currentTier])
      ),
      fullHistory: session.player.tierHistory.map(h => ({
        mode:         h.mode,
        previousTier: h.previousTier,
        earnedTier:   h.earnedTier,
        testerDiscordId: h.testerDiscordId,
        evidenceUrl:  h.evidenceUrl,
        notes:        h.notes,
        testedAt:     h.createdAt,
      })),
    },
    previousTier:    session.previousTier,
    earnedTier:      session.earnedTier,
    notes:           session.notes,
    evidenceUrl:     session.evidenceUrl,
    ticketChannelId: session.ticketChannelId,
  });
});

export default router;
