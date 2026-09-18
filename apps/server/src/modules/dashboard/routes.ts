import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  dashboardViewCreateSchema,
  dashboardViewUpdateSchema,
  DASHBOARD_COLUMNS,
  DASHBOARD_METRICS,
  DASHBOARD_STAGE_FILTERS,
} from '@tracker/shared';
import {
  listViews,
  createView,
  updateView,
  deleteView,
  getChartData,
  getDrillDown,
  DashboardError,
  type ChartFilters,
} from './dashboardService.js';

const idParam = z.object({ id: z.string().uuid() });
const columnQuery = z.object({ column: z.enum(DASHBOARD_COLUMNS) });
const drillDownQuery = columnQuery.extend({ value: z.string().min(1).max(200) });

// Baseline for chart/drill-down query params. metric / stage default to the
// same values a freshly created view carries; year omitted = all years.
const viewFilterQuery = {
  metric: z.enum(DASHBOARD_METRICS).default('count'),
  stage: z.enum(DASHBOARD_STAGE_FILTERS).default('all'),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
};
const chartDataQuery = columnQuery.extend(viewFilterQuery);
const drillDownFilteredQuery = drillDownQuery
  .pick({ column: true, value: true })
  .extend(viewFilterQuery);

function toChartFilters(p: z.infer<typeof chartDataQuery>): ChartFilters {
  return { metricKey: p.metric, stageFilter: p.stage, yearFilter: p.year ?? null };
}

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

// POST /api/dashboard/views — create a view (pie/bar of a whitelisted column,
// optionally with a metric + stage/year filter).
dashboardRouter.post('/views', async (req, res) => {
  try {
    const payload = dashboardViewCreateSchema.parse(req.body);
    res.status(201).json(await createView(req.user!, payload));
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /api/dashboard/views/:id — edit a view's label + filter/metric. Ownership
// enforced in the service (user_id baked into the WHERE clause).
dashboardRouter.patch('/views/:id', async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    const payload = dashboardViewUpdateSchema.parse(req.body);
    await updateView(req.user!, id, payload);
    res.json({ ok: true });
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

// GET /api/dashboard/chart-data?column=...&metric=...&stage=...&year=... —
// grouped values for one column, RBAC-scoped exactly like the grid.
dashboardRouter.get('/chart-data', async (req, res) => {
  try {
    const parsed = chartDataQuery.parse(req.query);
    res.json(await getChartData(req.user!, parsed.column, toChartFilters(parsed)));
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/dashboard/drill-down?column=...&value=...&stage=...&year=... — the
// scoped projects behind one chart slice/segment (respects the view's filters).
dashboardRouter.get('/drill-down', async (req, res) => {
  try {
    const parsed = drillDownFilteredQuery.parse(req.query);
    res.json(await getDrillDown(req.user!, parsed.column, parsed.value, toChartFilters(parsed)));
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