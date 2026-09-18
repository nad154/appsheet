import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  listProjects,
  listAssignableUsers,
  listProjectYears,
  createProject,
  updateProject,
  deleteProject,
  ProjectWriteError,
  type ProjectListQuery,
} from './projectsService.js';
import { updateProgressFieldSchema } from '@tracker/shared';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
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
    year: parsed.data.year,
  };

  const result = await listProjects(req.user!, query);
  res.json(result);
});

// GET /api/projects/years — distinct creation years within the caller's scope,
// newest first, for the grid's dynamic year-filter dropdown.
projectsRouter.get('/years', async (req, res) => {
  try {
    res.json(await listProjectYears(req.user!));
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/projects/users — active users eligible for PIC assignment.
projectsRouter.get('/users', async (_req, res) => {
  try {
    res.json(await listAssignableUsers());
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/projects — direct write for BOTH roles (STAFF writes apply
// immediately now; there is no pending approval queue).
projectsRouter.post('/', async (req, res) => {
  try {
    const result = await createProject(req.user!, req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /api/projects/:id — direct write for both roles. STAFF must include
// update_progress, which is peeled off here before the rest of the body is
// validated as an ordinary projectUpdateSchema payload.
projectsRouter.patch('/:id', async (req, res) => {
  const user = req.user!;
  const { id } = idParamSchema.parse(req.params);
  try {
    let updateProgress: string | undefined;
    let body = req.body;
    if (user.role === 'STAFF') {
      const { update_progress } = updateProgressFieldSchema.parse(req.body);
      updateProgress = update_progress;
      const { update_progress: _drop, ...rest } = req.body;
      body = rest;
    }
    await updateProject(user, id, body, updateProgress);
    res.json({ ok: true });
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
  if (err instanceof ProjectWriteError) {
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