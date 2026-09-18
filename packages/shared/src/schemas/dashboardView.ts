import { z } from 'zod';

export const CHART_TYPES = ['pie', 'bar'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// Whitelist of columns a user may build a view on. Server is authoritative —
// GET /api/dashboard/chart-data rejects any column not in this list.
export const DASHBOARD_COLUMNS = [
  'current_stage',
  'service_or_goods',
  'vendor_type',
  'market_segment',
  'staff_assigned_id',
  'pic_id',
  'priority',
] as const;
export type DashboardColumn = (typeof DASHBOARD_COLUMNS)[number];

// Whitelist of Y-axis aggregations. 'customer_price' is a PROJECT-level figure
// (projects.customer_price) and is only valid for project-based groupings;
// 'vendor_price' / 'vendor_revenue' are per vendor LINE; 'avg_aging' is the
// derived per-line aging averaged over the lines in a group. 'count' is the
// classic behavior (number of projects / vendor lines per group).
export const DASHBOARD_METRICS = [
  'count',
  'customer_price',
  'vendor_price',
  'vendor_revenue',
  'avg_aging',
] as const;
export type DashboardMetric = (typeof DASHBOARD_METRICS)[number];

// A view may restrict itself to one project stage ('all' = no restriction).
export const DASHBOARD_STAGE_FILTERS = ['all', 'on_progress', 'finish'] as const;
export type DashboardStageFilter = (typeof DASHBOARD_STAGE_FILTERS)[number];

// Vendor-line-based groupings (priority / vendor_type) aggregate over vendor
// lines, so a project-level metric like customer_price would be counted once
// per line (double counting multi-vendor projects). Server rejects those.
export const PROJECT_LEVEL_METRICS = new Set<DashboardMetric>(['customer_price']);
export const VENDOR_BASED_COLUMNS = new Set<DashboardColumn>(['priority', 'vendor_type']);

export const dashboardViewSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  metric_key: z.enum(DASHBOARD_METRICS).default('count'),
  stage_filter: z.enum(DASHBOARD_STAGE_FILTERS).default('all'),
  /** Calendar year to restrict to (matches the grid's creation-year filter). Null = all years. */
  year_filter: z.number().int().nullable().default(null),
  label: z.string().min(1),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
});

export const dashboardViewCreateSchema = z.object({
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  metric_key: z.enum(DASHBOARD_METRICS).default('count'),
  stage_filter: z.enum(DASHBOARD_STAGE_FILTERS).default('all'),
  year_filter: z.number().int().min(2000).max(2100).nullable().default(null),
  label: z.string().min(1).max(80),
});

export const dashboardViewUpdateSchema = dashboardViewCreateSchema
  .omit({ chart_type: true, column_key: true })
  .partial();

export type DashboardView = z.infer<typeof dashboardViewSchema>;
export type DashboardViewCreate = z.infer<typeof dashboardViewCreateSchema>;
export type DashboardViewUpdate = z.infer<typeof dashboardViewUpdateSchema>;

// Response shape for GET /api/dashboard/chart-data
export const chartDataSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
});
export type ChartData = z.infer<typeof chartDataSchema>;

// Response shape for GET /api/dashboard/drill-down — the RBAC-scoped projects
// that fall under one chart slice/segment.
// vendor_name is populated only for vendor-based columns (vendor_type /
// priority) where the panel lists one entry per matching vendor LINE — a
// project can then appear more than once, each time next to the vendor that
// put it in that bucket. All other columns keep one entry per project with
// vendor_name null (planning_customers_vendors §3.3).
export const drillDownSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string().uuid(),
      project_name: z.string(),
      vendor_name: z.string().nullable().optional(),
    }),
  ),
});
export type DrillDownResult = z.infer<typeof drillDownSchema>;