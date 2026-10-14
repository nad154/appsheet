import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  getGridPreferences,
  saveGridPreferences,
  resetGridPreferences,
  PreferencesError,
} from './preferencesService.js';

export const preferencesRouter = Router();
// Every route is scoped to the authenticated user's token — there is no user
// id in the URL or body, so a caller can only read/write their own prefs.
preferencesRouter.use(requireAuth);

// GET /api/me/preferences/grid-columns — this user's column visibility.
preferencesRouter.get('/grid-columns', async (req, res) => {
  try {
    res.json(await getGridPreferences(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
});

// PUT /api/me/preferences/grid-columns — validate and store for this user.
preferencesRouter.put('/grid-columns', async (req, res) => {
  try {
    res.json(await saveGridPreferences(req.user!.id, req.body));
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /api/me/preferences/grid-columns — reset to default.
preferencesRouter.delete('/grid-columns', async (req, res) => {
  try {
    await resetGridPreferences(req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof PreferencesError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Preferences error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
