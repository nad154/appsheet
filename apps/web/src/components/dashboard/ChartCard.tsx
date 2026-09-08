import { useMemo } from 'react';
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
} from 'recharts';
import { useChartData } from '../../hooks/useDashboard';
import type { DashboardView } from '@tracker/shared';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

interface ChartRow {
  name: string;
  value: number;
}

export function ChartCard({ view, onDelete }: { view: DashboardView; onDelete: (id: string) => void }) {
  const { data, isLoading, isError } = useChartData(view.column_key);

  const chartRows: ChartRow[] = useMemo(() => {
    if (!data) return [];
    return data.labels.map((label, i) => ({ name: label, value: data.values[i] ?? 0 }));
  }, [data]);

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{view.label}</h3>
        <button
          type="button"
          onClick={() => onDelete(view.id)}
          className="text-xs font-medium text-gray-400 transition-colors hover:text-red-600"
          aria-label={`Delete view ${view.label}`}
        >
          Delete
        </button>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-gray-400">Loading chart…</p>}
      {isError && <p className="py-10 text-center text-sm text-red-500">Failed to load chart data.</p>}
      {!isLoading && !isError && data && chartRows.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-400">No data yet.</p>
      )}
      {!isLoading && !isError && chartRows.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          {view.chart_type === 'pie' ? (
            <PieChart>
              <Pie data={chartRows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}>
                {chartRows.map((row, i) => (
                  <Cell key={row.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={chartRows}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Count">
                {chartRows.map((row, i) => (
                  <Cell key={row.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}