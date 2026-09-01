import { useMemo, useState } from 'react';
import { useProjects, type ProjectQueryParams } from '../../hooks/useProjects';
import { usePendingEdits, useMyPendingEdits } from '../../hooks/usePendingEdits';
import { ProjectTable, type SortDir, type EditResult } from '../../components/data-grid/ProjectTable';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../hooks/useAuth';
import { useToast  } from '../../components/Toast';

const emptyForm = {
  project_name: '',
  folder_name: '',
  customer_name: '',
  market_segment: '',
  vendor_name: '',
  vendor_revenue: '',
  customer_price: '',
  vendor_price: '',
  service_or_goods: '',
  current_stage: 'on_progress',
};

export function GridPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const { showToast } = useToast();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<string | undefined>('updated_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [notice, setNotice] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const params: ProjectQueryParams = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
  const { data, isLoading, isError, refetch: refetchProjects } = useProjects(params);

  const allPending = usePendingEdits('pending');
  const minePending = useMyPendingEdits();
  const pendingList = (isAdmin ? allPending.data : minePending.data) ?? [];

  const pendingProjectIds = useMemo(
    () => new Set(pendingList.filter((e) => e.project_id).map((e) => e.project_id as string)),
    [pendingList],
  );

  const handleCellUpdate = async (
    row: { id: string },
    field: string,
    value: unknown,
  ): Promise<EditResult> => {
    try {
      const res = await apiClient.patch<{ ok?: boolean; submitted?: boolean }>(
        `/api/projects/${row.id}`,
        { [field]: value },
      );
      if (res?.submitted) {
        await Promise.all([refetchProjects(), allPending.refetch(), minePending.refetch()]);
        return { ok: true, pending: true };
      }
      await refetchProjects();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof ApiError ? e.message : 'Could not save change.' };
    }
  };

  const handlePageChange = (next: number) => setPage(Math.max(1, next));
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  const handleSortChange = (nextSortBy: string, nextSortDir: SortDir) => {
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    setPage(1);
  };

  const setField = (key: keyof typeof emptyForm, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleAddProject = async () => {
    setAddSaving(true);
    setAddError(null);
    const toNumber = (v: string) => (v === '' ? null : Number(v));
    try {
      const payload = {
        project_name: form.project_name.trim(),
        folder_name: form.folder_name.trim() || null,
        customer_name: form.customer_name.trim() || null,
        market_segment: form.market_segment.trim() || null,
        vendor_name: form.vendor_name.trim() || null,
        vendor_revenue: toNumber(form.vendor_revenue),
        customer_price: toNumber(form.customer_price),
        vendor_price: toNumber(form.vendor_price),
        service_or_goods: (form.service_or_goods || null) as 'service' | 'goods' | null,
        current_stage: form.current_stage as 'on_progress' | 'finish',
      };
      const res = await apiClient.post<{ ok?: boolean; submitted?: boolean }>('/api/projects', payload);
      if (res?.submitted) {
        showToast('Project submitted — pending approval.', 'success');
        await Promise.all([minePending.refetch()]);
      } else {
        showToast('Project created.', 'success');
        await refetchProjects();
      }
      setShowAddForm(false);
      setForm(emptyForm);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : 'Could not create project.');
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Project Grid</h1>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {isAdmin ? 'Add project' : 'Propose new project'}
        </button>
      </div>

      {showAddForm && (
        <div className="mb-4 rounded border border-gray-200 p-4">
          <h2 className="mb-3 text-sm font-semibold">New project</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex flex-col text-xs text-gray-600">
              Project name *
              <input value={form.project_name} onChange={(e) => setField('project_name', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Folder
              <input value={form.folder_name} onChange={(e) => setField('folder_name', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Customer
              <input value={form.customer_name} onChange={(e) => setField('customer_name', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Market segment
              <input value={form.market_segment} onChange={(e) => setField('market_segment', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Vendor
              <input value={form.vendor_name} onChange={(e) => setField('vendor_name', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Customer price
              <input type="number" value={form.customer_price} onChange={(e) => setField('customer_price', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Vendor price
              <input type="number" value={form.vendor_price} onChange={(e) => setField('vendor_price', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Type
              <select value={form.service_or_goods} onChange={(e) => setField('service_or_goods', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">–</option>
                <option value="service">service</option>
                <option value="goods">goods</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Stage
              <select value={form.current_stage} onChange={(e) => setField('current_stage', e.target.value)} className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="on_progress">on_progress</option>
                <option value="finish">finish</option>
              </select>
            </label>
          </div>
          {addError && <p className="mt-3 text-sm text-red-600">{addError}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddProject}
              disabled={addSaving || !form.project_name.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {addSaving ? 'Submitting…' : isAdmin ? 'Create' : 'Submit for approval'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="rounded border px-3 py-1.5 text-sm text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      <ProjectTable
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        sortBy={sortBy}
        sortDir={sortDir}
        isLoading={isLoading}
        isError={isError}
        pendingProjectIds={pendingProjectIds}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        onCellUpdate={handleCellUpdate}
        onNotice={showToast}
      />
      {/* {isLoading && <p className="mt-2 text-sm text-gray-500">Loading…</p>} */}
    </div>
  );
}
