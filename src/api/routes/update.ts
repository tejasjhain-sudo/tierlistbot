import { Router, Request, Response } from 'express';
import { performGitUpdate } from '../../services/updateService';

const router = Router();

// POST /api/webhook/update - GitHub Webhook Auto-Deploy endpoint
router.post('/update', async (req: Request, res: Response): Promise<any> => {
  const authHeader = req.headers['x-update-secret'] || req.headers['authorization'];
  const expectedSecret = process.env.UPDATE_WEBHOOK_SECRET;

  if (expectedSecret && authHeader !== expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized webhook request' });
  }

  console.log('[Auto-Updater] Webhook trigger received! Starting automatic git pull & rebuild...');
  res.json({ message: 'Update triggered successfully. Bot will pull, build, and restart.' });

  // Execute update in background after responding
  setTimeout(async () => {
    const result = await performGitUpdate();
    if (result.success) {
      console.log('[Auto-Updater] Rebuild successful! Restarting process for Pterodactyl...');
      process.exit(0);
    } else {
      console.error('[Auto-Updater] Failed to build update:', result.error);
    }
  }, 1000);
});

export default router;
