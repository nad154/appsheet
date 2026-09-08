import { useState } from 'react';
import { useDashboardViews, useDeleteDashboardView } from '../../hooks/useDashboard';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { AddViewForm } from '../../components/dashboard/AddViewForm';
import { useToast } from '../../components/Toast';

export function DashboardPage() {
  const { data: views, isLoading } = useDashboardViews();
  const deleteView = useDeleteDashboardView();
  const { showToast } = useToast();
  const [showAdd, setShowAdd] = useState(false);

  const handleDelete = async (id: string) => {
    try {
      await deleteView.mutateAsync(id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete view.', 'error');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showAdd ? 'Cancel' : 'Add view'}
        </button>
      </div>

      {showAdd && <AddViewForm onDone={() => setShowAdd(false)} />}

      {isLoading && <p className="text-sm text-gray-500">Loading views…</p>}
      {views && views.length === 0 && !isLoading && (
        <p className="text-sm text-gray-400">No views yet — add one to get started.</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {views?.map((v) => (
          <ChartCard key={v.id} view={v} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}