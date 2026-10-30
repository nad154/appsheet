import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  listProjects,
  getProject,
  listAssignableUsers,
  listProjectYears,
  createProject,
  updateProject,
  deleteProject,
  ProjectWriteError,
  listAllProjectsForExport,
  loadUserEmails,
  type ProjectListQuery,
} from './projectsService.js';
import { buildProjectsCsv } from '../csv-export/csvExport.js';
import { updateProgressFieldSchema, PROJECT_STAGES } from '@tracker/shared';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
});

// The export accepts the same filters/sort as the list but always spans every
// page, so pagination params are dropped from the schema (unknown query keys
// are stripped by zod, so a stray ?page= is ignored rather than misread).
const exportQuerySchema = listQuerySchema.omit({ page: true, page_size: true });

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
    stage: parsed.data.stage,
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

// GET /api/projects/export.csv — the caller's whole scoped set as CSV: same
// RBAC scope, year/stage filters and sort as the grid, but every page (not just
// the visible one). Both roles may export; only Import stays SUPER_ADMIN-only.
//
// Must stay ABOVE GET /:id — otherwise the id validator would reject
// "export.csv" with a 400.
projectsRouter.get('/export.csv', async (req, res) => {
  try {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const rows = await listAllProjectsForExport(req.user!, {
      sort_by: parsed.data.sort_by,
      sort_dir: parsed.data.sort_dir,
      year: parsed.data.year,
      stage: parsed.data.stage,
    });
    const emailById = await loadUserEmails();
    const filename = `projects-${localDateString()}.csv`;

    // setHeader (not res.attachment) so the filename stays exactly as written.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildProjectsCsv(rows, { emailById }));
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/projects/:id — one full row (vendors + derived meta), RBAC-scoped.
projectsRouter.get('/:id', async (req, res) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getProject(req.user!, id));
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

/** Today's LOCAL date as YYYY-MM-DD — the export filename must follow the
 *  user's calendar day, not UTC's. */
function localDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
