import { useState } from 'react';
import { useDashboardViews, useDeleteDashboardView } from '../../hooks/useDashboard';
import { ChartCard } from '../../components/dashboard/ChartCard';
import { AddViewForm } from '../../components/dashboard/AddViewForm';
import { useToast } from '../../components/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';

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
      <PageHeader
        title="Dashboard"
        actions={<Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Cancel' : 'Add view'}</Button>}
      />

      {showAdd && <AddViewForm onDone={() => setShowAdd(false)} />}

      {isLoading && <p className="text-sm text-ink-muted">Loading views…</p>}
      {views && views.length === 0 && !isLoading && (
        <p className="text-sm text-ink-muted">No views yet — add one to get started.</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {views?.map((v) => (
          <ChartCard key={v.id} view={v} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
