import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  VendorError,
} from './vendorsService.js';

const idParam = z.object({ id: z.string().uuid() });

export const vendorsRouter = Router();
vendorsRouter.use(requireAuth);

// GET /api/vendors?q= — any authenticated role.
vendorsRouter.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json(await listVendors(q));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/vendors — any authenticated role (STAFF can add inline from combobox).
vendorsRouter.post('/', async (req, res) => {
  try {
    const result = await createVendor(req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH/DELETE — SUPER_ADMIN only.
vendorsRouter.use(requireRole('SUPER_ADMIN'));

vendorsRouter.patch('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await updateVendor(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

vendorsRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    const usageCount = await deleteVendor(id);
    res.json({ ok: true, usageCount });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof VendorError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  console.error('Vendors error:', err);
  res.status(500).json({ error: 'Internal server error' });
}