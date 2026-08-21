import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import playerRoutes from './routes/players';
import leaderboardRoutes from './routes/leaderboard';
import queueRoutes from './routes/queues';
import statsRoutes from './routes/stats';
import adminRoutes from './routes/admin';
import sessionRoutes from './routes/sessions';
import authRoutes from './routes/auth';
import { Client } from 'discord.js';
import verificationRoutes from './routes/verification';
import accountsRoutes from './routes/accounts';
import updateRoutes from './routes/update';

let discordClientInstance: Client | undefined;

export function setDiscordClient(client: Client): void {
  discordClientInstance = client;
}

export function getDiscordClient(): Client | undefined {
  return discordClientInstance;
}

export function startApiServer(client?: Client): void {
  if (client) setDiscordClient(client);
  const app = express();

  // ─── Middleware ────────────────────────────────────────────────────────────
  app.use(cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : '*',
    methods: ['GET', 'POST', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-api-secret'],
  }));

  app.use(express.json({ limit: '1mb' }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use(limiter);

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/players', playerRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/queues', queueRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/verification', verificationRoutes);
  app.use('/api/accounts', accountsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/webhook', updateRoutes);

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // 404 handler
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Global error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(config.apiPort, '0.0.0.0', () => {
    console.log(`🚀 REST API running on port ${config.apiPort}`);
  });
}
