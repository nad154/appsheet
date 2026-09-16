import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getHistoryAndMarkRead, ProjectUpdatesError } from './projectUpdatesService.js';

const idParam = z.object({ id: z.string().uuid() });

export const projectUpdatesRouter = Router();
projectUpdatesRouter.use(requireAuth);

// SUPER_ADMIN only, per spec — this is also what clears the grid's yellow dot.
projectUpdatesRouter.get('/:id/updates', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    res.json(await getHistoryAndMarkRead(id));
  } catch (err) {
    if (err instanceof ProjectUpdatesError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: err.flatten() });
      return;
    }
    console.error('Project updates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});