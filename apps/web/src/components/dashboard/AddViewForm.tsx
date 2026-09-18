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

  const selectCls =
    'rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap items-end gap-3 rounded border border-gray-200 p-4">
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-500">Chart type</span>
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
        <span className="text-[11px] text-gray-500">Group by</span>
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
          <span className="text-[11px] text-gray-500">Value (Y axis)</span>
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
        <span className="text-[11px] text-gray-500">Stage</span>
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
        <span className="text-[11px] text-gray-500">Year</span>
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
        <span className="text-[11px] text-gray-500">Display label</span>
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

      <button
        type="submit"
        disabled={createView.isPending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {createView.isPending ? 'Adding…' : 'Add view'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}