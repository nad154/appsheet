import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  CustomerError,
} from './customersService.js';

const idParam = z.object({ id: z.string().uuid() });

export const customersRouter = Router();
customersRouter.use(requireAuth);

// GET /api/customers?q= — any authenticated role (combobox needs it for both).
customersRouter.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json(await listCustomers(q));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/customers — any authenticated role (STAFF can add inline from combobox).
customersRouter.post('/', async (req, res) => {
  try {
    const result = await createCustomer(req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH/DELETE — SUPER_ADMIN only.
customersRouter.use(requireRole('SUPER_ADMIN'));

customersRouter.patch('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    await updateCustomer(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

customersRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try {
    const usageCount = await deleteCustomer(id);
    res.json({ ok: true, usageCount });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof CustomerError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  console.error('Customers error:', err);
  res.status(500).json({ error: 'Internal server error' });
}