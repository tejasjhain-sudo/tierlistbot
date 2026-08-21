import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
  if (!key || key !== config.apiSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
