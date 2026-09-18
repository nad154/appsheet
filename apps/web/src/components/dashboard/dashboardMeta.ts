import type { DashboardColumn, DashboardMetric, DashboardStageFilter } from '@tracker/shared';
import { VENDOR_BASED_COLUMNS } from '@tracker/shared';

export const METRIC_LABELS: Record<DashboardMetric, string> = {
  count: 'Count',
  customer_price: 'Sum customer price',
  vendor_price: 'Sum vendor price',
  vendor_revenue: 'Sum vendor revenue',
  avg_aging: 'Average aging (days)',
};

export const STAGE_LABELS: Record<DashboardStageFilter, string> = {
  all: 'All stages',
  on_progress: 'On progress',
  finish: 'Finished',
};

// Mirrors the server rule: customer_price is a project-level figure and is
// rejected for vendor-line-based groupings (priority / vendor_type) to avoid
// double counting a multi-vendor project's price in several buckets.
export function allowedMetricsFor(column: DashboardColumn): DashboardMetric[] {
  if (VENDOR_BASED_COLUMNS.has(column)) {
    return ['count', 'vendor_price', 'vendor_revenue', 'avg_aging'];
  }
  return ['count', 'customer_price', 'vendor_price', 'vendor_revenue', 'avg_aging'];
}

// Compact Y-axis/tooltip formatting for large IDR prices (values are seeded in
// millions). Falls back to the raw number for small values.
export function formatChartValue(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(Math.round(value * 100) / 100);
}