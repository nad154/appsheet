import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listMarketSegments,
  createMarketSegment,
  updateMarketSegment,
  listUsers,
  createUser,
  updateUser,
  SettingsError,
} from './settingsService.js';

const idParam = z.object({ id: z.string().uuid() });

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

// Market segments
settingsRouter.get('/market-segments', async (_req, res) => {
  try {
    res.json(await listMarketSegments());
  } catch (err) {
    handleError(err, res);
  }
});

settingsRouter.post('/market-segments', async (req, res) => {
  try {
    const result = await createMarketSegment(req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

settingsRouter.patch('/market-segments/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await updateMarketSegment(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

// Users
settingsRouter.get('/users', async (_req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    handleError(err, res);
  }
});

settingsRouter.post('/users', async (req, res) => {
  try {
    const result = await createUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

settingsRouter.patch('/users/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await updateUser(id, req.body, req.user!);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof SettingsError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Settings error:', err);
  res.status(500).json({ error: 'Internal server error' });
}