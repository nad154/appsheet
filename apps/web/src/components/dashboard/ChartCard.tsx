import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  CartesianGrid,
} from 'recharts';
import { useChartData, useUpdateDashboardView } from '../../hooks/useDashboard';
import { useProjectYears } from '../../hooks/useProjects';
import { DrillDownPanel } from './DrillDownPanel';
import { CHART_COLORS } from '../../lib/chartColors';
import {
  METRIC_LABELS,
  STAGE_LABELS,
  formatChartValue,
  allowedMetricsFor,
} from './dashboardMeta';
import type {
  DashboardView,
  DashboardColumn,
  DashboardMetric,
  DashboardStageFilter,
} from '@tracker/shared';

const AXIS_TICK = { fontSize: 11, fill: '#6b6262' } as const;

// White tooltip card with a soft shadow; matches the `shadow-overlay` token.
const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #ece7e7',
  borderRadius: '0.5rem',
  boxShadow: '0 12px 32px -12px rgba(127,29,29,0.30)',
} as const;

interface ChartRow {
  name: string;
  value: number;
}

export function ChartCard({ view, onDelete }: { view: DashboardView; onDelete: (id: string) => void }) {
  const navigate = useNavigate();
  const updateView = useUpdateDashboardView();
  const yearOptions = useProjectYears();
  const { data, isLoading, isError } = useChartData(view.column_key, {
    metric: view.metric_key,
    stage: view.stage_filter,
    year: view.year_filter,
  });
  const [drillDown, setDrillDown] = useState<{ columnKey: DashboardColumn; value: string } | null>(null);

  // Filters are driven by the persisted view, but kept in local state so the
  // selects don't snap back while a PATCH + refetch is in flight.
  const [stageSel, setStageSel] = useState<DashboardStageFilter>(view.stage_filter);
  const [yearSel, setYearSel] = useState<string>(view.year_filter == null ? '' : String(view.year_filter));
  const [metricSel, setMetricSel] = useState<DashboardMetric>(view.metric_key);

  useEffect(() => {
    setStageSel(view.stage_filter);
    setYearSel(view.year_filter == null ? '' : String(view.year_filter));
    setMetricSel(view.metric_key);
  }, [view.id, view.stage_filter, view.year_filter, view.metric_key]);

  const isBar = view.chart_type === 'bar';

  const chartRows: ChartRow[] = useMemo(() => {
    if (!data) return [];
    return data.labels.map((label, i) => ({ name: label, value: data.values[i] ?? 0 }));
  }, [data]);

  const handleSliceClick = (entry: unknown) => {
    setDrillDown({ columnKey: view.column_key, value: (entry as ChartRow).name });
  };

  const handleStageChange = (value: DashboardStageFilter) => {
    setStageSel(value);
    updateView.mutate({ id: view.id, body: { stage_filter: value } });
  };
  const handleYearChange = (value: string) => {
    setYearSel(value);
    updateView.mutate({ id: view.id, body: { year_filter: value === '' ? null : Number(value) } });
  };
  const handleMetricChange = (value: DashboardMetric) => {
    setMetricSel(value);
    updateView.mutate({ id: view.id, body: { metric_key: value } });
  };

  const filterCls =
    'rounded-full border border-border bg-canvas px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/25';

  return (
    // `border-gray-200` is a structural locator used by dashboard-drilldown.spec.
    <div className="relative rounded-xl border border-gray-200 bg-surface p-4 shadow-card transition-shadow hover:shadow-overlay">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-brand-500"
        aria-hidden="true"
      />
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: CHART_COLORS[0] }}
            aria-hidden="true"
          />
          {view.label}
        </h3>
        <button
          type="button"
          onClick={() => onDelete(view.id)}
          className="text-xs font-medium text-ink-muted transition-colors hover:text-danger"
          aria-label={`Delete view ${view.label}`}
        >
          Delete
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={stageSel}
          onChange={(e) => handleStageChange(e.target.value as DashboardStageFilter)}
          className={filterCls}
          aria-label={`Stage filter for ${view.label}`}
        >
          {(Object.keys(STAGE_LABELS) as DashboardStageFilter[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={yearSel}
          onChange={(e) => handleYearChange(e.target.value)}
          className={filterCls}
          aria-label={`Year filter for ${view.label}`}
        >
          <option value="">All years</option>
          {(yearOptions.data ?? []).map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>

        {isBar && (
          <select
            value={metricSel}
            onChange={(e) => handleMetricChange(e.target.value as DashboardMetric)}
            className={filterCls}
            aria-label={`Metric for ${view.label}`}
          >
            {allowedMetricsFor(view.column_key).map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Loading chart…</p>}
      {isError && <p className="py-10 text-center text-sm text-danger">Failed to load chart data.</p>}
      {!isLoading && !isError && data && chartRows.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-muted">No data yet.</p>
      )}
      {!isLoading && !isError && chartRows.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          {!isBar ? (
            <PieChart>
              <Pie
                data={chartRows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={2}
                onClick={handleSliceClick}
                className="cursor-pointer"
              >
                {chartRows.map((row, i) => (
                  <Cell key={row.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={chartRows}>
              <CartesianGrid stroke="#ece7e7" vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis
                allowDecimals={view.metric_key === 'avg_aging'}
                tick={AXIS_TICK}
                tickFormatter={formatChartValue}
              />
              <Tooltip formatter={(v) => formatChartValue(Number(v))} contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Bar
                dataKey="value"
                name={METRIC_LABELS[view.metric_key]}
                radius={[6, 6, 0, 0]}
                onClick={handleSliceClick}
                className="cursor-pointer"
              >
                {chartRows.map((row, i) => (
                  <Cell key={row.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}

      {drillDown && (
        <DrillDownPanel
          columnKey={drillDown.columnKey}
          value={drillDown.value}
          stage={view.stage_filter}
          year={view.year_filter}
          onSelect={(id) => navigate('/grid', { state: { highlightProjectId: id } })}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}