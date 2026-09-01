import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listPendingEdits,
  listMine,
  getDiff,
  approve,
  reject,
  PendingEditError,
} from './pendingEditsService.js';

const statusQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const rejectSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const pendingEditsRouter = Router();
pendingEditsRouter.use(requireAuth);

// SUPER_ADMIN queue (optionally filtered by status).
pendingEditsRouter.get('/', requireRole('SUPER_ADMIN'), async (req, res) => {
  const parsed = statusQuerySchema.safeParse(req.query);
  try {
    const rows = await listPendingEdits(parsed.success ? parsed.data.status : undefined);
    res.json(rows);
  } catch (err) {
    handleError(err, res);
  }
});

// STAFF: their own submission history.
pendingEditsRouter.get('/mine', async (req, res) => {
  try {
    const rows = await listMine(req.user!.id);
    res.json(rows);
  } catch (err) {
    handleError(err, res);
  }
});

pendingEditsRouter.get('/:id/diff', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    const diff = await getDiff(id);
    res.json(diff);
  } catch (err) {
    handleError(err, res);
  }
});

pendingEditsRouter.post('/:id/approve', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await approve(id, req.user!);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

pendingEditsRouter.post('/:id/reject', requireRole('SUPER_ADMIN'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = rejectSchema.safeParse(req.body);
  try {
    await reject(id, req.user!, body.success ? body.data.note : undefined);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof PendingEditError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Pending edits error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
