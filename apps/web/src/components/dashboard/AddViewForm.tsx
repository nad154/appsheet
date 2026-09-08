import { useState } from 'react';
import { useCreateDashboardView } from '../../hooks/useDashboard';
import { CHART_TYPES, DASHBOARD_COLUMNS } from '@tracker/shared';
import type { ChartType, DashboardColumn } from '@tracker/shared';

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
  const [chartType, setChartType] = useState<ChartType>('pie');
  const [column, setColumn] = useState<DashboardColumn>('current_stage');
  const [label, setLabel] = useState(COLUMN_LABELS.current_stage);
  const [error, setError] = useState<string | null>(null);

  const handleColumnChange = (value: DashboardColumn) => {
    setColumn(value);
    setLabel(COLUMN_LABELS[value]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createView.mutateAsync({
        chart_type: chartType,
        column_key: column,
        label: label.trim() || COLUMN_LABELS[column],
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create view.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap items-end gap-3 rounded border border-gray-200 p-4">
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-500">Chart type</span>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {CHART_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'pie' ? 'Pie' : 'Bar'}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-500">Column</span>
        <select
          value={column}
          onChange={(e) => handleColumnChange(e.target.value as DashboardColumn)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {DASHBOARD_COLUMNS.map((c) => (
            <option key={c} value={c}>
              {COLUMN_LABELS[c]}
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
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
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