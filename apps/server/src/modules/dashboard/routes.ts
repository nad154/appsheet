import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { dashboardViewCreateSchema, DASHBOARD_COLUMNS } from '@tracker/shared';
import { listViews, createView, deleteView, getChartData, getDrillDown, DashboardError } from './dashboardService.js';

const idParam = z.object({ id: z.string().uuid() });
const columnQuery = z.object({ column: z.enum(DASHBOARD_COLUMNS) });
const drillDownQuery = columnQuery.extend({ value: z.string().min(1).max(200) });

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// GET /api/dashboard/views — this user's views only.
dashboardRouter.get('/views', async (req, res) => {
  try {
    res.json(await listViews(req.user!.id));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/dashboard/views — create a view (pie/bar of a whitelisted column).
dashboardRouter.post('/views', async (req, res) => {
  try {
    const payload = dashboardViewCreateSchema.parse(req.body);
    res.status(201).json(await createView(req.user!, payload));
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /api/dashboard/views/:id — ownership enforced in the service (user_id
// baked into the WHERE clause).
dashboardRouter.delete('/views/:id', async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    await deleteView(req.user!, id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/dashboard/chart-data?column=... — grouped counts for one column,
// RBAC-scoped exactly like the grid.
dashboardRouter.get('/chart-data', async (req, res) => {
  try {
    const { column } = columnQuery.parse(req.query);
    res.json(await getChartData(req.user!, column));
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/dashboard/drill-down?column=...&value=... — the scoped projects
// behind one chart slice/segment (click-through from a pie/bar).
dashboardRouter.get('/drill-down', async (req, res) => {
  try {
    const { column, value } = drillDownQuery.parse(req.query);
    res.json(await getDrillDown(req.user!, column, value));
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof DashboardError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Dashboard error:', err);
  res.status(500).json({ error: 'Internal server error' });
}