import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from './notificationsService.js';

const idParam = z.object({ id: z.string().uuid() });
const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  try {
    const { limit } = limitQuery.parse(req.query);
    const items = await listNotifications(req.user!.id, limit);
    res.json(items);
  } catch (err) {
    handleError(err, res);
  }
});

notificationsRouter.get('/unread-count', async (req, res) => {
  try {
    const count = await getUnreadCount(req.user!.id);
    res.json({ count });
  } catch (err) {
    handleError(err, res);
  }
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await markAsRead(id, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

notificationsRouter.post('/read-all', async (req, res) => {
  try {
    await markAllAsRead(req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Notifications error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
