import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  listForProject,
  addVendorLine,
  updateVendorLine,
  removeVendorLine,
  ProjectVendorError,
} from './projectVendorsService.js';

const projectIdParam = z.object({ projectId: z.string().uuid() });
const lineIdParam = z.object({ id: z.string().uuid() });

// Mounted at /api/projects (see app.ts) — nested vendor-line routes.
export const projectVendorsRouter = Router();
projectVendorsRouter.use(requireAuth);

// GET /api/projects/:projectId/vendors — this project's vendor lines.
projectVendorsRouter.get('/:projectId/vendors', async (req, res) => {
  try {
    const { projectId } = projectIdParam.parse(req.params);
    res.json(await listForProject(projectId));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/projects/:projectId/vendors — add a vendor line.
projectVendorsRouter.post('/:projectId/vendors', async (req, res) => {
  const { projectId } = projectIdParam.parse(req.params);
  try {
    const result = await addVendorLine(req.user!, projectId, req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /api/projects/:projectId/vendors/:id — update one vendor line.
projectVendorsRouter.patch('/:projectId/vendors/:id', async (req, res) => {
  const { id } = lineIdParam.parse(req.params);
  try {
    await updateVendorLine(req.user!, id, req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /api/projects/:projectId/vendors/:id — remove one vendor line.
projectVendorsRouter.delete('/:projectId/vendors/:id', async (req, res) => {
  const { id } = lineIdParam.parse(req.params);
  try {
    await removeVendorLine(req.user!, id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof ProjectVendorError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  console.error('Project vendors error:', err);
  res.status(500).json({ error: 'Internal server error' });
}