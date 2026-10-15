import { useState } from 'react';
import { useCreateDashboardView } from '../../hooks/useDashboard';
import { useProjectYears } from '../../hooks/useProjects';
import { CHART_TYPES, DASHBOARD_COLUMNS } from '@tracker/shared';
import type {
  ChartType,
  DashboardColumn,
  DashboardMetric,
  DashboardStageFilter,
} from '@tracker/shared';
import { METRIC_LABELS, STAGE_LABELS, allowedMetricsFor } from './dashboardMeta';
import { Button } from '../ui/Button';

const selectCls =
  'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

const COLUMN_LABELS: Record<DashboardColumn, string> = {
  current_stage: 'Stage',
  service_or_goods: 'Service / Goods',
  vendor_type: 'Vendor type',
  market_segment: 'Market segment',
  staff_assigned_id: 'Sales',
  pic_id: 'PIC',
  priority: 'Priority',
};

export function AddViewForm({ onDone }: { onDone: () => void }) {
  const createView = useCreateDashboardView();
  const years = useProjectYears();
  const [chartType, setChartType] = useState<ChartType>('pie');
  const [column, setColumn] = useState<DashboardColumn>('current_stage');
  const [metric, setMetric] = useState<DashboardMetric>('count');
  const [stage, setStage] = useState<DashboardStageFilter>('all');
  const [year, setYear] = useState<string>('');
  const [label, setLabel] = useState(COLUMN_LABELS.current_stage);
  const [error, setError] = useState<string | null>(null);

  const handleColumnChange = (value: DashboardColumn) => {
    setColumn(value);
    setLabel(COLUMN_LABELS[value]);
    // customer_price is invalid for vendor-based groupings — switch back to a
    // valid default so the form never submits something the server rejects.
    const allowed = allowedMetricsFor(value);
    if (!allowed.includes(metric)) setMetric('count');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createView.mutateAsync({
        chart_type: chartType,
        column_key: column,
        metric_key: chartType === 'bar' ? metric : 'count',
        stage_filter: stage,
        year_filter: year === '' ? null : Number(year),
        label: label.trim() || COLUMN_LABELS[column],
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create view.');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Chart type</span>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
          className={selectCls}
        >
          {CHART_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'pie' ? 'Pie' : 'Bar'}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Group by</span>
        <select
          value={column}
          onChange={(e) => handleColumnChange(e.target.value as DashboardColumn)}
          className={selectCls}
        >
          {DASHBOARD_COLUMNS.map((c) => (
            <option key={c} value={c}>
              {COLUMN_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      {chartType === 'bar' && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-muted">Value (Y axis)</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as DashboardMetric)}
            className={selectCls}
          >
            {allowedMetricsFor(column).map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Stage</span>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as DashboardStageFilter)}
          className={selectCls}
        >
          {(Object.keys(STAGE_LABELS) as DashboardStageFilter[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Year</span>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className={selectCls}
          aria-label="Filter by creation year"
        >
          <option value="">All years</option>
          {(years.data ?? []).map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Display label</span>
        <input
          type="text"
          required
          maxLength={80}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={selectCls}
          placeholder="e.g. Projects by stage"
        />
      </label>

      <Button type="submit" disabled={createView.isPending}>
        {createView.isPending ? 'Adding…' : 'Add view'}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}
