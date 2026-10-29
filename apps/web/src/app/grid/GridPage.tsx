import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { packIntoPages } from '@tracker/shared';
import { computeAging, computePriority } from '@tracker/shared';
import type { ProjectStage } from '@tracker/shared';
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
import { buildColumnVisibility, getColumnSizes } from '../../components/data-grid/columns';
import { StickyColumnsMenu } from '../../components/data-grid/StickyColumnsMenu';
import { ColumnsMenu } from '../../components/data-grid/ColumnsMenu';
import { useStickyColumns } from '../../hooks/useStickyColumns';
import { useGridPreferences } from '../../hooks/useGridPreferences';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { ImportCsvModal } from '../../components/import/ImportCsvModal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select, controlClass } from '../../components/ui/Input';
import {
  FIELD_LABELS,
  FIELD_SELECT_OPTIONS,
  FIELD_TYPES,
  NUMBER_FIELDS,
  SECTION_OF,
  SECTION_ORDER,
} from '../../lib/projectFields';

const emptyForm = {
  project_name: '',
  folder_name: '',
  market_segment: '',
  customer_price: '',
  service_or_goods: '',
  current_stage: 'on_progress',
  staff_assigned_id: '',
  pic_id: '',
  date_customer_received_doc1: '',
  date_customer_received_doc2: '',
  doc2_number_id: '',
  customer_start_contract: '',
  customer_end_contract: '',
};

const ADD_EDITABLE_FIELDS = Object.keys(FIELD_TYPES).filter((k) => k !== 'customer_id' && k !== 'issues');

export function GridPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { stickyColumnIds, setStickyColumnIds, resetStickyColumns } = useStickyColumns(user?.id);
  const {
    hiddenColumnIds,
    hiddenGroupIds,
    setHidden,
    applyPreset,
    reset: resetGridPreferences,
  } = useGridPreferences(user?.id);

  const columnVisibility = useMemo(
    () => buildColumnVisibility(hiddenColumnIds, hiddenGroupIds),
    [hiddenColumnIds, hiddenGroupIds],
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined);
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);
  const [stageFilter, setStageFilter] = useState<ProjectStage | undefined>(undefined);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [stageFinishConfirm, setStageFinishConfirm] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
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

  const params: ProjectQueryParams = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir, year: yearFilter, stage: stageFilter };
  const { data, isLoading, isError, refetch: refetchProjects } = useProjects(params);
  const assignable = useAssignableUsers();
  const years = useProjectYears();
  const users = assignable.data ?? [];
  // Only active STAFF accounts may be assigned as PIC (or left unassigned).
  const staffUsers = users.filter((u) => u.role === 'STAFF');
  const thresholds = useAgingThresholds();
  const agingThresholds = thresholds.data ?? { low_max_days: 0, medium_max_days: 0 };

  // Locator query: while a highlight is pending, fetch the full scoped set so
  // the target project's page can be computed even when it isn't on page 1. It
  // sorts with the same (possibly default) sort as the grid, so the computed
  // page always matches the order actually displayed. Uses the same greedy
  // packIntoPages the server used, so the two can never disagree on boundaries.
  const locator = useProjects(
    highlightedRowId
      ? { page: 1, page_size: 500, sort_by: sortBy, sort_dir: sortDir, year: yearFilter, stage: stageFilter }
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

  const handleRowDelete = async (row: { id: string }): Promise<EditResult> => {
    try {
      await apiClient.del<{ ok?: boolean }>(`/api/projects/${row.id}`);
      const res = await refetchProjects();
      // The deleted project may have been the last row on the last page —
      // fall back to the first page instead of showing an empty grid.
      if ((res.data?.rows.length ?? 0) === 0 && page > 1) setPage(1);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof ApiError ? e.message : 'Could not delete project.' };
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

  const handleStageChange = (next: string) => {
    setStageFilter(next === 'all' ? undefined : (next as ProjectStage));
    setPage(1);
  };

  const setField = (key: keyof typeof emptyForm, value: string) => setForm((f:any) => ({ ...f, [key]: value }));

  const handleConfirmStageFinish = () => {
    setForm((f:any) => ({ ...f, current_stage: 'finish' }));
    setStageFinishConfirm(false);
  };

  const loadCustomers = async (q: string): Promise<EntityOption[]> =>
    apiClient.get<EntityOption[]>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  const createCustomer = async (name: string): Promise<string> => {
    const res = await apiClient.post<{ id: string }>('/api/customers', { name });
    return res.id;
  };

  // Local copies of date/price inputs for the add form (same UX as edit modal)
  function sanitizeNumeric(input: string): string {
    const cleaned = input.replace(/[^0-9.]/g, '');
    return cleaned.replace(/(\..*)\./g, '$1');
  }

  function PriceFieldAdd({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) {
    const [focused, setFocused] = useState(false);
    const [editing, setEditing] = useState('');

    const handleFocus = () => {
      setEditing(value);
      setFocused(true);
    };

    const handleBlur = () => {
      setFocused(false);
      onChange(sanitizeNumeric(editing));
    };

    const display = focused ? editing : value ? `Rp ${Number(value).toLocaleString('id-ID')}` : '';

    return (
      <input
        type="text"
        inputMode="numeric"
        value={display}
        placeholder="Rp —"
        aria-label={ariaLabel}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => setEditing(sanitizeNumeric(e.target.value))}
        className={controlClass}
      />
    );
  }

  function DateFieldAdd({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) {
    const inputRef = useRef<HTMLInputElement>(null);

    const openPicker = () => {
      const el = inputRef.current;
      if (!el) return;
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      if (typeof el.showPicker === 'function') {
        try {
          el.showPicker();
          return;
        } catch {
          // fall through
        }
      }
      el.click();
    };

    const display = value
      ? new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';

    return (
      <div className="relative flex w-full items-center">
        <button
          type="button"
          onClick={openPicker}
          title={display || 'Pick a date'}
          className={`flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1 text-left text-sm ${controlClass} ${
            display ? 'text-ink' : 'text-ink-muted'
          }`}
        >
          <span className="flex-1">{display || '—'}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 text-ink-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>
        {value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            aria-label="Clear date"
            title="Clear date"
            className="absolute right-8 rounded p-1 text-xs text-ink-muted hover:bg-canvas hover:text-ink"
          >
            ✕
          </button>
        )}
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    );
  }

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
      const payload: Record<string, unknown> = {
        project_name: form.project_name.trim(),
        folder_name: form.folder_name.trim() || null,
        customer_id: customerId || null,
        market_segment: form.market_segment.trim() || null,
        service_or_goods: (form.service_or_goods || null) as 'service' | 'goods' | null,
        date_customer_received_doc1: form.date_customer_received_doc1 || null,
        date_customer_received_doc2: form.date_customer_received_doc2 || null,
        doc2_number_id: form.doc2_number_id.trim() || null,
        customer_price: toNumber(form.customer_price),
        customer_start_contract: form.customer_start_contract || null,
        customer_end_contract: form.customer_end_contract || null,
        current_stage: form.current_stage as 'on_progress' | 'finish',
        ...(isAdmin ? { pic_id: form.pic_id || null } : {}),
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

  const fieldLabel = 'flex flex-col gap-1 text-xs font-medium text-ink-muted';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Project Grid"
        actions={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={() => setShowImportCsv((v) => !v)}
                data-testid="open-import-csv"
              >
                {showImportCsv ? 'Cancel' : 'Import CSV'}
              </Button>
            )}
            <Button onClick={() => setShowAddForm((v) => !v)}>{showAddForm ? 'Cancel' : 'Add project'}</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-accent px-3 py-2 shadow-card">
        <label className="flex items-center gap-1.5 text-xs text-white">
          Year
          <Select
            value={yearFilter ?? ''}
            onChange={(e) => handleYearChange(e.target.value)}
            className="!w-auto py-1 text-sm"
            aria-label="Filter by creation year"
          >
            <option value="">All years</option>
            {(years.data ?? []).map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-white">
          Stage
          <Select
            value={stageFilter ?? 'all'}
            onChange={(e) => handleStageChange(e.target.value)}
            className="!w-auto py-1 text-sm"
            aria-label="Filter by project stage"
          >
            <option value="all">All stages</option>
            <option value="on_progress">{STAGE_LABEL.on_progress}</option>
            <option value="finish">{STAGE_LABEL.finish}</option>
          </Select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <ColumnsMenu
            hiddenColumnIds={hiddenColumnIds}
            hiddenGroupIds={hiddenGroupIds}
            onChange={setHidden}
            onPreset={applyPreset}
            onReset={resetGridPreferences}
          />
          <StickyColumnsMenu
            selectedIds={stickyColumnIds}
            columnWidths={getColumnSizes()}
            onChange={setStickyColumnIds}
            onReset={resetStickyColumns}
          />
        </div>
      </div>

      {showAddForm && (
        <Card title="New project" className="mb-4">
          <fieldset className="mb-4 rounded border-2 border-border bg-canvas/60 p-3">
            <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Project info
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className={fieldLabel}>
                {FIELD_LABELS.project_name} *
                <input value={form.project_name} onChange={(e) => setField('project_name', e.target.value)} className={controlClass} />
              </label>
              <label className={fieldLabel}>
                {FIELD_LABELS.folder_name}
                <input value={form.folder_name} onChange={(e) => setField('folder_name', e.target.value)} className={controlClass} />
              </label>
              {ADD_EDITABLE_FIELDS.filter((k) => (SECTION_OF[k] ?? 'Other') === 'Project info')
                .filter((k) => (k !== 'staff_assigned_id' || isAdmin) && (k !== 'pic_id' || isAdmin) && (k !== 'current_stage' || isAdmin))
                .map((key) => {
                  const editType = FIELD_TYPES[key] ?? 'text';
                  if (editType === 'date') {
                    return (
                      <label key={key} className={fieldLabel}>
                        {FIELD_LABELS[key] ?? key}
                        <DateFieldAdd value={form[key] ?? ''} onChange={(v) => setField(key as keyof typeof emptyForm, v)} ariaLabel={FIELD_LABELS[key] ?? key} />
                      </label>
                    );
                  }
                  if (editType === 'number') {
                    return (
                      <label key={key} className={fieldLabel}>
                        {FIELD_LABELS[key] ?? key}
                        <PriceFieldAdd value={form[key] ?? ''} onChange={(v) => setField(key as keyof typeof emptyForm, v)} ariaLabel={FIELD_LABELS[key] ?? key} />
                      </label>
                    );
                  }
                  if (editType === 'select') {
                    if (key === 'current_stage') {
                      return (
                        <label key={key} className={fieldLabel}>
                          {FIELD_LABELS[key] ?? key}
                          <Select
                            value={form.current_stage}
                            onChange={(e) => {
                              const next = e.target.value;
                              if (next === 'finish') setStageFinishConfirm(true);
                              else setField('current_stage', next);
                            }}
                            className="py-1"
                          >
                            <option value="on_progress">{STAGE_LABEL.on_progress}</option>
                            <option value="finish">{STAGE_LABEL.finish}</option>
                          </Select>
                        </label>
                      );
                    }
                    return (
                      <label key={key} className={fieldLabel}>
                        {FIELD_LABELS[key] ?? key}
                        <Select value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className="py-1">
                          <option value="">–</option>
                          {(FIELD_SELECT_OPTIONS[key] ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      </label>
                    );
                  }
                  if (editType === 'user') {
                    const options = key === 'pic_id' ? staffUsers : users;
                    return (
                      <label key={key} className={fieldLabel}>
                        {FIELD_LABELS[key] ?? key}
                        <Select value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className="py-1">
                          <option value="">–</option>
                          {options.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                    );
                  }
                  if (editType === 'textarea') {
                    return (
                      <label key={key} className={`${fieldLabel} md:col-span-2`}>
                        {FIELD_LABELS[key] ?? key}
                        <textarea rows={3} value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className={`${controlClass} resize-y`} />
                      </label>
                    );
                  }
                  return (
                    <label key={key} className={fieldLabel}>
                      {FIELD_LABELS[key] ?? key}
                      <input value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className={controlClass} />
                    </label>
                  );
                })}
            </div>
          </fieldset>

          <fieldset className="mb-4 rounded border-2 border-border bg-canvas/60 p-3 [&_input:not([type='date'])]:bg-white [&_select]:bg-white [&_textarea]:bg-white">
            <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Customer
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className={fieldLabel}>
                {FIELD_LABELS.customer_id ?? 'Customer'}
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
              {ADD_EDITABLE_FIELDS.filter((k) => (SECTION_OF[k] ?? 'Other') === 'Customer').map((key) => {
                const editType = FIELD_TYPES[key] ?? 'text';
                if (editType === 'date') {
                  return (
                    <label key={key} className={fieldLabel}>
                      {FIELD_LABELS[key] ?? key}
                      <DateFieldAdd value={form[key] ?? ''} onChange={(v) => setField(key as keyof typeof emptyForm, v)} ariaLabel={FIELD_LABELS[key] ?? key} />
                    </label>
                  );
                }
                if (editType === 'number') {
                  return (
                    <label key={key} className={fieldLabel}>
                      {FIELD_LABELS[key] ?? key}
                      <PriceFieldAdd value={form[key] ?? ''} onChange={(v) => setField(key as keyof typeof emptyForm, v)} ariaLabel={FIELD_LABELS[key] ?? key} />
                    </label>
                  );
                }
                if (editType === 'select') {
                  return (
                    <label key={key} className={fieldLabel}>
                      {FIELD_LABELS[key] ?? key}
                      <Select value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className="py-1">
                        <option value="">–</option>
                        {(FIELD_SELECT_OPTIONS[key] ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                    </label>
                  );
                }
                if (editType === 'textarea') {
                  return (
                    <label key={key} className={`${fieldLabel} md:col-span-2`}>
                      {FIELD_LABELS[key] ?? key}
                      <textarea rows={3} value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className={`${controlClass} resize-y`} />
                    </label>
                  );
                }
                return (
                  <label key={key} className={fieldLabel}>
                    {FIELD_LABELS[key] ?? key}
                    <input value={form[key] ?? ''} onChange={(e) => setField(key as keyof typeof emptyForm, e.target.value)} className={controlClass} />
                  </label>
                );
              })}
            </div>
          </fieldset>


          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Vendor lines {vendorDrafts.length > 0 && <span className="normal-case">({vendorDrafts.length})</span>}
            </legend>
            {vendorDrafts.length === 0 && (
              <p className="mb-2 text-xs text-ink-muted">No vendor lines yet (optional) — add one below.</p>
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
            <Button variant="secondary" size="sm" className="mt-3 border-dashed" onClick={addBlankLine}>
              + Add vendor
            </Button>
          </fieldset>

          {addError && <p className="mt-3 text-sm text-danger">{addError}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={handleAddProject} disabled={addSaving || !form.project_name.trim()}>
              {addSaving ? 'Submitting…' : 'Create'}
            </Button>
            <Button variant="secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
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
        onDelete={handleRowDelete}
        onNotice={showToast}
        highlightedRowId={highlightedRowId}
        onHighlightDone={() => setHighlightedRowId(null)}
        stickyColumnIds={stickyColumnIds}
        columnVisibility={columnVisibility}
      />

      {showImportCsv && (
        <ImportCsvModal
          onClose={() => setShowImportCsv(false)}
          onImported={() => void refetchProjects()}
        />
      )}

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
