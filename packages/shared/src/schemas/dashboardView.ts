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

export const dashboardViewSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  label: z.string().min(1),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
});

export const dashboardViewCreateSchema = z.object({
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  label: z.string().min(1).max(80),
});

export type DashboardView = z.infer<typeof dashboardViewSchema>;
export type DashboardViewCreate = z.infer<typeof dashboardViewCreateSchema>;

// Response shape for GET /api/dashboard/chart-data
export const chartDataSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
});
export type ChartData = z.infer<typeof chartDataSchema>;