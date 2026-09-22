import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { packIntoPages } from '@tracker/shared';
import { computeAging, computePriority } from '@tracker/shared';
import { useProjects, useAssignableUsers, useProjectYears, type ProjectQueryParams } from '../../hooks/useProjects';
import { useAgingThresholds } from '../../hooks/useSettings';
import { ProjectTable, type SortDir, type EditResult } from '../../components/data-grid/ProjectTable';
import {
  blankLineDraft,
  normalizeVendorField,
  VENDOR_LINE_FIELDS,
  VendorLineRow,
  type VendorLineDraft,
} from '../../components/data-grid/EditProjectModal';
import { EntityCombobox, type EntityOption } from '../../components/EntityCombobox';
import { StageConfirmModal } from '../../components/data-grid/StageConfirmModal';
import { STAGE_LABEL } from '../../components/data-grid/columns';
import { getColumnSizes } from '../../components/data-grid/columns';
import { StickyColumnsMenu } from '../../components/data-grid/StickyColumnsMenu';
import { useStickyColumns } from '../../hooks/useStickyColumns';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';

const emptyForm = {
  project_name: '',
  folder_name: '',
  market_segment: '',
  customer_price: '',
  service_or_goods: '',
  current_stage: 'on_progress',
  staff_assigned_id: '',
  pic_id: '',
};

export function GridPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { stickyColumnIds, setStickyColumnIds, resetStickyColumns } = useStickyColumns(user?.id);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined);
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [stageFinishConfirm, setStageFinishConfirm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [customerId, setCustomerId] = useState('');
  const [vendorDrafts, setVendorDrafts] = useState<VendorLineDraft[]>([]);

  // Set only when arriving via a dashboard drill-down click
  // (navigate('/grid', { state: { highlightProjectId } })).
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(
    () => (location.state?.highlightProjectId as string | undefined) ?? null,
  );

  // Consume the navigation state once so a plain refresh of /grid doesn't
  // re-trigger the highlight.
  useEffect(() => {
    if (location.state?.highlightProjectId) {
      navigate('.', { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params: ProjectQueryParams = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir, year: yearFilter };
  const { data, isLoading, isError, refetch: refetchProjects } = useProjects(params);
  const assignable = useAssignableUsers();
  const years = useProjectYears();
  const users = assignable.data ?? [];
  const thresholds = useAgingThresholds();
  const agingThresholds = thresholds.data ?? { low_max_days: 0, medium_max_days: 0 };

  // Locator query: while a highlight is pending, fetch the full scoped set so
  // the target project's page can be computed even when it isn't on page 1. It
  // sorts with the same (possibly default) sort as the grid, so the computed
  // page always matches the order actually displayed. Uses the same greedy
  // packIntoPages the server used, so the two can never disagree on boundaries.
  const locator = useProjects(
    highlightedRowId
      ? { page: 1, page_size: 500, sort_by: sortBy, sort_dir: sortDir, year: yearFilter }
      : { page: 1, page_size: 500, enabled: false },
  );

  // Jump to the page containing the highlighted project as soon as the locator
  // data is available. Drops the highlight silently if the row isn't in the
  // user's scoped set (deleted, or not visible to this role).
  useEffect(() => {
    if (!highlightedRowId || !locator.data) return;
    const pages = packIntoPages(
      locator.data.rows.map((r) => ({ id: r.id, lineCount: (r.vendors ?? []).length })),
      pageSize,
    );
    const pageIdx = pages.findIndex((p) => p.includes(highlightedRowId));
    if (pageIdx === -1) {
      setHighlightedRowId(null);
      return;
    }
    setPage(pageIdx + 1);
  }, [highlightedRowId, locator.data, pageSize]);

  const handleRowUpdate = async (
    row: { id: string },
    changes: Record<string, unknown>,
  ): Promise<EditResult> => {
    // Nothing changed (modal opened and saved as-is) — no PATCH to send.
    if (Object.keys(changes).length === 0) return { ok: true };
    try {
      // One PATCH carrying only the changed fields. STAFF writes apply
      // immediately (no approval queue anymore).
      await apiClient.patch<{ ok?: boolean }>(`/api/projects/${row.id}`, changes);
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
  const handleSortChange = (nextSortBy: string | undefined, nextSortDir: SortDir | undefined) => {
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    setPage(1);
  };

  const handleYearChange = (next: string) => {
    setYearFilter(next === '' ? undefined : Number(next));
    setPage(1);
  };

  const setField = (key: keyof typeof emptyForm, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleConfirmStageFinish = () => {
    setForm((f) => ({ ...f, current_stage: 'finish' }));
    setStageFinishConfirm(false);
  };

  const loadCustomers = async (q: string): Promise<EntityOption[]> =>
    apiClient.get<EntityOption[]>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  const createCustomer = async (name: string): Promise<string> => {
    const res = await apiClient.post<{ id: string }>('/api/customers', { name });
    return res.id;
  };

  const loadVendors = async (q: string): Promise<EntityOption[]> =>
    apiClient.get<EntityOption[]>(`/api/vendors${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  const createVendor = async (name: string): Promise<string> => {
    const res = await apiClient.post<{ id: string }>('/api/vendors', { name });
    return res.id;
  };

  const setVendorField = (key: keyof VendorLineDraft, keyId: string, value: string) =>
    setVendorDrafts((ds) => ds.map((d) => (d.key === keyId ? { ...d, [key]: value } : d)));

  const addBlankLine = () => setVendorDrafts((ds) => [...ds, blankLineDraft(ds.length)]);

  const removeLine = (keyId: string) => setVendorDrafts((ds) => ds.filter((d) => d.key !== keyId));

  const draftPriority = (d: VendorLineDraft): 'low' | 'medium' | 'high' | null =>
    computePriority(
      computeAging({ project_sent_date: d.project_sent_date || null, approval_date: d.approval_date || null }),
      agingThresholds,
    );

  const handleAddProject = async () => {
    setAddSaving(true);
    setAddError(null);
    const toNumber = (v: string) => (v === '' ? null : Number(v));
    try {
      const vendors = vendorDrafts
        .filter((d) => d.vendor_id)
        .map((d, i) => ({
          vendor_id: d.vendor_id,
          sort_order: i,
          ...Object.fromEntries(
            VENDOR_LINE_FIELDS.map((f) => [f.key, normalizeVendorField(f.key, String(d[f.key] ?? ''))]),
          ),
        }));
      const payload = {
        project_name: form.project_name.trim(),
        folder_name: form.folder_name.trim() || null,
        customer_id: customerId || null,
        market_segment: form.market_segment.trim() || null,
        customer_price: toNumber(form.customer_price),
        service_or_goods: (form.service_or_goods || null) as 'service' | 'goods' | null,
        current_stage: form.current_stage as 'on_progress' | 'finish',
        pic_id: form.pic_id || null,
        ...(isAdmin ? { staff_assigned_id: form.staff_assigned_id || null } : {}),
        vendors,
      };
      await apiClient.post<{ ok?: boolean }>('/api/projects', payload);
      showToast('Project created.', 'success');
      await refetchProjects();
      setShowAddForm(false);
      setForm(emptyForm);
      setCustomerId('');
      setVendorDrafts([]);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : 'Could not create project.');
    } finally {
      setAddSaving(false);
    }
  };

  const inputCls =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Project Grid</h1>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Year
            <select
              value={yearFilter ?? ''}
              onChange={(e) => handleYearChange(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
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
          <StickyColumnsMenu
            selectedIds={stickyColumnIds}
            columnWidths={getColumnSizes()}
            onChange={setStickyColumnIds}
            onReset={resetStickyColumns}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add project
        </button>
      </div>

      {showAddForm && (
        <div className="mb-4 rounded border border-gray-200 p-4">
          <h2 className="mb-3 text-sm font-semibold">New project</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex flex-col text-xs text-gray-600">
              Project name *
              <input value={form.project_name} onChange={(e) => setField('project_name', e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Folder
              <input value={form.folder_name} onChange={(e) => setField('folder_name', e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-xs text-gray-600 md:col-span-2">
              Customer
              <EntityCombobox
                value={customerId}
                valueLabel={null}
                onSelect={setCustomerId}
                loadOptions={loadCustomers}
                onCreate={createCustomer}
                placeholder="Search or add customer"
                ariaLabel="Customer"
              />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Market segment
              <input value={form.market_segment} onChange={(e) => setField('market_segment', e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Nilai PO/PKS Customer
              <input type="number" value={form.customer_price} onChange={(e) => setField('customer_price', e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-xs text-gray-600">
              Type
              <select value={form.service_or_goods} onChange={(e) => setField('service_or_goods', e.target.value)} className={inputCls}>
                <option value="">–</option>
                <option value="service">service</option>
                <option value="goods">goods</option>
              </select>
            </label>
            {isAdmin && (
              <label className="flex flex-col text-xs text-gray-600">
                Stage
                <select
                  value={form.current_stage}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === 'finish') setStageFinishConfirm(true);
                    else setField('current_stage', next);
                  }}
                  className={inputCls}
                >
                  <option value="on_progress">{STAGE_LABEL.on_progress}</option>
                  <option value="finish">{STAGE_LABEL.finish}</option>
                </select>
              </label>
            )}
            {isAdmin && (
              <label className="flex flex-col text-xs text-gray-600">
                Sales
                <select value={form.staff_assigned_id} onChange={(e) => setField('staff_assigned_id', e.target.value)} className={inputCls}>
                  <option value="">–</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col text-xs text-gray-600">
              PIC
              <select value={form.pic_id} onChange={(e) => setField('pic_id', e.target.value)} className={inputCls}>
                <option value="">–</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Vendor lines {vendorDrafts.length > 0 && <span className="normal-case">({vendorDrafts.length})</span>}
            </legend>
            {vendorDrafts.length === 0 && (
              <p className="mb-2 text-xs text-gray-400">No vendor lines yet (optional) — add one below.</p>
            )}
            <div className="space-y-4">
              {vendorDrafts.map((d, index) => (
                <VendorLineRow
                  key={d.key}
                  line={d}
                  index={index}
                  priority={draftPriority(d)}
                  valueLabel={null}
                  loadVendors={loadVendors}
                  createVendor={createVendor}
                  onChange={(key, value) => setVendorField(key, d.key, value)}
                  onSelectVendor={(id) => setVendorField('vendor_id', d.key, id)}
                  onRemove={() => removeLine(d.key)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addBlankLine}
              className="mt-3 rounded border border-dashed border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
            >
              + Add vendor
            </button>
          </fieldset>

          {addError && <p className="mt-3 text-sm text-red-600">{addError}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddProject}
              disabled={addSaving || !form.project_name.trim()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {addSaving ? 'Submitting…' : 'Create'}
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
        totalPages={data?.total_pages ?? 1}
        totalLines={data?.total_lines ?? (data?.rows.length ?? 0)}
        page={page}
        pageSize={pageSize}
        sortBy={sortBy}
        sortDir={sortDir}
        isLoading={isLoading}
        isError={isError}
        users={users}
        isAdmin={isAdmin}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        onRowUpdate={handleRowUpdate}
        onNotice={showToast}
        highlightedRowId={highlightedRowId}
        onHighlightDone={() => setHighlightedRowId(null)}
        stickyColumnIds={stickyColumnIds}
      />

      {stageFinishConfirm && (
        <StageConfirmModal
          projectName={form.project_name.trim() || 'this project'}
          onConfirm={handleConfirmStageFinish}
          onCancel={() => setStageFinishConfirm(false)}
        />
      )}
    </div>
  );
}