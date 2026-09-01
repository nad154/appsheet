import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { listProjects, type ProjectListQuery } from './projectsService.js';
import {
  createDirect,
  updateDirect,
  deleteProject,
  submitCreate,
  submitUpdate,
  PendingEditError,
} from '../pending-edits/pendingEditsService.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

// GET /api/projects — RBAC-filtered server-side, paginated, sortable.
projectsRouter.get('/', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    return;
  }

  const query: ProjectListQuery = {
    page: parsed.data.page,
    page_size: parsed.data.page_size,
    sort_by: parsed.data.sort_by,
    sort_dir: parsed.data.sort_dir,
  };

  const result = await listProjects(req.user!, query);
  res.json(result);
});

// POST /api/projects — branches by role:
// SUPER_ADMIN writes directly to projects; STAFF submits a CREATE pending edit.
projectsRouter.post('/', async (req, res) => {
  const user = req.user!;
  try {
    if (user.role === 'SUPER_ADMIN') {
      const result = await createDirect(user, req.body);
      res.status(201).json(result);
      return;
    }
    const result = await submitCreate(user, req.body);
    res.status(202).json({ ...result, submitted: true });
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /api/projects/:id — branches by role:
// SUPER_ADMIN updates directly; STAFF submits an UPDATE pending edit (202).
projectsRouter.patch('/:id', async (req, res) => {
  const user = req.user!;
  const { id } = idParamSchema.parse(req.params);
  try {
    if (user.role === 'SUPER_ADMIN') {
      await updateDirect(user, id, req.body);
      res.json({ ok: true });
      return;
    }
    const result = await submitUpdate(user, id, req.body);
    res.status(202).json({ ...result, submitted: true });
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /api/projects/:id — SUPER_ADMIN only.
projectsRouter.delete('/:id', async (req, res) => {
  const user = req.user!;
  const { id } = idParamSchema.parse(req.params);
  try {
    await deleteProject(user, id);
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
  console.error('Projects error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
