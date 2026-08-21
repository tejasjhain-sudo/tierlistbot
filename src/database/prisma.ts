import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.databaseUrl,
    },
  },
  log: config.nodeEnv === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
});

export default prisma;
