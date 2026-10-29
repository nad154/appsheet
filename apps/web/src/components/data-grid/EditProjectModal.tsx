import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Project, ProjectStage, ProjectVendorLine } from '@tracker/shared';
import { computeAging, computePriority } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
// Removed: useLinkFolder / useCreateFolder imports (moved to UNUSED_DRIVE.md)
import { useAgingThresholds } from '../../hooks/useSettings';
import { formatGridDate, formatGridNumber } from '../../lib/format';
import {
  useAddVendorLine,
  useUpdateVendorLine,
  useRemoveVendorLine,
} from '../../hooks/useProjectVendors';
import { apiClient } from '../../lib/api-client';
import { EntityCombobox, type EntityOption } from '../EntityCombobox';
// Removed: useToast import (only used by the removed Drive folder handlers)
import {
  FIELD_LABELS,
  FIELD_SELECT_OPTIONS,
  FIELD_TYPES,
  NUMBER_FIELDS,
  SECTION_OF,
  SECTION_ORDER,
  VENDOR_NUMBER_FIELDS,
} from '../../lib/projectFields';
import { STAGE_LABEL, STAGE_STYLES } from './columns';
import { StageConfirmModal } from './StageConfirmModal';
import { DeleteProjectConfirmModal } from './DeleteProjectConfirmModal';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { EditResult } from './ProjectTable';
import type { ToastVariant } from '../Toast';

interface EditProjectModalProps {
  project: Project;
  users: AssignableUser[];
  isAdmin: boolean;
  onClose: () => void;
  onSave: (row: Project, changes: Record<string, unknown>) => Promise<EditResult>;
  // SUPER_ADMIN-only project delete. Omitted (or non-admin) hides the button.
  onDelete?: (row: Project) => Promise<EditResult>;
  onNotice?: (message: string, variant?: ToastVariant) => void;
}

// Every editable PROJECT-LEVEL field, in FIELD_TYPES order. Vendor-section
// fields are NOT here anymore — they live on project_vendors and are edited in
// the Vendor lines section below. issues is excluded: it's SUPER_ADMIN-only,
// logged only through the Issues modal's add endpoint.
const EDITABLE_FIELDS = Object.keys(FIELD_TYPES).filter((k) => k !== 'customer_id' && k !== 'issues');

export interface VendorLineDraft {
  key: string;
  id?: string;
  sort_order: number;
  vendor_id: string;
  vendor_type: string;
  vendor_revenue: string;
  project_sent_date: string;
  project_finish_date: string;
  vendor_project_id: string;
  negotiation_date: string;
  approval_date: string;
  document_sent_date: string;
  document_id: string;
  vendor_price: string;
  vendor_start_contract: string;
  vendor_end_contract: string;
}

export const VENDOR_LINE_FIELDS: { key: keyof VendorLineDraft; label: string; type: 'date' | 'number' | 'text' | 'select'; options?: readonly string[] }[] = [
  { key: 'vendor_type', label: FIELD_LABELS.vendor_type, type: 'select', options: FIELD_SELECT_OPTIONS.vendor_type },
  { key: 'vendor_revenue', label: FIELD_LABELS.vendor_revenue, type: 'number' },
  { key: 'project_sent_date', label: FIELD_LABELS.project_sent_date, type: 'date' },
  { key: 'project_finish_date', label: FIELD_LABELS.project_finish_date, type: 'date' },
  { key: 'vendor_project_id', label: FIELD_LABELS.vendor_project_id, type: 'text' },
  { key: 'negotiation_date', label: FIELD_LABELS.negotiation_date, type: 'date' },
  { key: 'approval_date', label: FIELD_LABELS.approval_date, type: 'date' },
  { key: 'document_sent_date', label: FIELD_LABELS.document_sent_date, type: 'date' },
  { key: 'document_id', label: FIELD_LABELS.document_id, type: 'text' },
  { key: 'vendor_price', label: FIELD_LABELS.vendor_price, type: 'number' },
  { key: 'vendor_start_contract', label: FIELD_LABELS.vendor_start_contract, type: 'date' },
  { key: 'vendor_end_contract', label: FIELD_LABELS.vendor_end_contract, type: 'date' },
];

const DELEGATED_VENDOR_FIELDS: (keyof VendorLineDraft)[] = VENDOR_LINE_FIELDS.map((f) => f.key);

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `new-${draftKeyCounter}`;
}

function toLineDraft(line: ProjectVendorLine): VendorLineDraft {
  const sliceDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
  return {
    key: line.id,
    id: line.id,
    sort_order: line.sort_order,
    vendor_id: line.vendor_id,
    vendor_type: line.vendor_type ?? '',
    vendor_revenue: line.vendor_revenue === null || line.vendor_revenue === undefined ? '' : String(line.vendor_revenue),
    project_sent_date: sliceDate(line.project_sent_date),
    project_finish_date: sliceDate(line.project_finish_date),
    vendor_project_id: line.vendor_project_id ?? '',
    negotiation_date: sliceDate(line.negotiation_date),
    approval_date: sliceDate(line.approval_date),
    document_sent_date: sliceDate(line.document_sent_date),
    document_id: line.document_id ?? '',
    vendor_price: line.vendor_price === null || line.vendor_price === undefined ? '' : String(line.vendor_price),
    vendor_start_contract: sliceDate(line.vendor_start_contract),
    vendor_end_contract: sliceDate(line.vendor_end_contract),
  };
}

export function blankLineDraft(index: number): VendorLineDraft {
  return {
    key: nextDraftKey(),
    sort_order: index,
    vendor_id: '',
    vendor_type: '',
    vendor_revenue: '',
    project_sent_date: '',
    project_finish_date: '',
    vendor_project_id: '',
    negotiation_date: '',
    approval_date: '',
    document_sent_date: '',
    document_id: '',
    vendor_price: '',
    vendor_start_contract: '',
    vendor_end_contract: '',
  };
}

function toDraft(project: Project): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const key of EDITABLE_FIELDS) {
    // Multi-user PICs are held in their own string[] state, not a text draft.
    if (key === 'pic_ids') continue;
    const raw = (project as unknown as Record<string, unknown>)[key];
    let value = raw === null || raw === undefined ? '' : String(raw);
    // <input type="date"> requires YYYY-MM-DD.
    if (FIELD_TYPES[key] === 'date' && value.length > 10) value = value.slice(0, 10);
    draft[key] = value;
  }
  return draft;
}

// Mirrors the server's conversion: empty draft → null, numeric fields → number.
function normalize(key: string, value: string): unknown {
  if (NUMBER_FIELDS.has(key)) return value === '' ? null : Number(value);
  return value === '' ? null : value;
}

// Per-vendor-line normalize: same rules, with the vendor number fields.
export function normalizeVendorField(key: keyof VendorLineDraft, value: string): unknown {
  if (VENDOR_NUMBER_FIELDS.has(key)) return value === '' ? null : Number(value);
  return value === '' ? null : value;
}

// Stage control (SUPER_ADMIN only). A finished project renders a read-only
// green badge — it can never be reopened. Otherwise a labeled select; picking
// "Finish" first opens the confirm modal, and only flips the draft (to
// "finish") once the user confirms.
function StageFieldInput({
  value,
  projectStage,
  onSelectFinish,
  onChange,
}: {
  value: string;
  projectStage: ProjectStage;
  onSelectFinish: () => void;
  onChange: (value: string) => void;
}) {
  const label = <span className="text-xs text-ink-muted">{FIELD_LABELS.current_stage}</span>;
  const cls =
    'mt-1 w-full rounded border border-border px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40';

  if (projectStage === 'finish') {
    return (
      <label className="flex flex-col">
        {label}
        <span
          className={`mt-1 inline-block w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${STAGE_STYLES.finish}`}
        >
          {STAGE_LABEL.finish}
        </span>
      </label>
    );
  }

  return (
    <label className="flex flex-col">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === 'finish') onSelectFinish();
          else onChange(next);
        }}
        className={cls}
        aria-label="Stage"
      >
        <option value="on_progress">{STAGE_LABEL.on_progress}</option>
        <option value="finish">{STAGE_LABEL.finish}</option>
      </select>
    </label>
  );
}

// Number/price fields render like the grid ("Rp 1,234,567") once the field
// loses focus. While focused you type raw digits (no cursor jumping); the draft
// stays a plain string so normalize()'s Number() conversion is unchanged.
function PriceField({
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

  const display = focused ? editing : value ? `Rp ${formatGridNumber(value)}` : '';

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
      className={`mt-1 w-full rounded border border-border px-2 py-1 text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/40 ${
        display ? 'text-ink' : 'text-ink-muted'
      }`}
    />
  );
}

// Keep only digits and at most one decimal point — mirrors Number(v) parsing
// on save.
function sanitizeNumeric(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, '');
  return cleaned.replace(/(\..*)\./g, '$1');
}

// Date fields show the long grid format ("15 September 2026"); clicking the
// field opens the native date picker, and ✕ clears it. The draft stays YYYY-MM-DD.
function DateField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = formatGridDate(value);

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
        // fall through to click
      }
    }
    el.click();
  };

  return (
    <div
      data-date-field
      className="relative mt-1 flex w-full items-center rounded border border-border px-2 py-1"
    >
      <button
        type="button"
        onClick={openPicker}
        title={display || 'Pick a date'}
        className={`flex flex-1 cursor-pointer items-center justify-between gap-2 text-left text-sm focus:outline-none ${
          display ? 'text-ink' : 'text-ink-muted'
        }`}
      >
        {display || '—'}
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
          className="relative z-10 ml-1 rounded p-1 text-xs text-ink-muted hover:bg-canvas hover:text-ink"
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

function FieldInput({
  field,
  value,
  users,
  onChange,
}: {
  field: string;
  value: string;
  users: AssignableUser[];
  onChange: (key: string, value: string) => void;
}) {
  const editType = FIELD_TYPES[field] ?? 'text';
  const label = <span className="text-xs text-ink-muted">{FIELD_LABELS[field] ?? field}</span>;
  // Empty fields render their value/placeholder in light gray so a null/blank
  // field reads as empty instead of looking like plain dark text.
  const cls = `mt-1 w-full rounded border border-border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 ${
    value ? 'text-ink' : 'text-ink-muted'
  }`;

  if (editType === 'date') {
    return (
      <label className="flex flex-col">
        {label}
        <DateField value={value} onChange={(v) => onChange(field, v)} ariaLabel={FIELD_LABELS[field] ?? field} />
      </label>
    );
  }

  if (editType === 'number') {
    return (
      <label className="flex flex-col">
        {label}
        <PriceField value={value} onChange={(v) => onChange(field, v)} ariaLabel={FIELD_LABELS[field] ?? field} />
      </label>
    );
  }

  if (editType === 'user') {
    // Sales keeps the full active-user list. (PICs use the multi-select below.)
    const options = users;
    return (
      <label className="flex flex-col">
        {label}
        <select value={value} onChange={(e) => onChange(field, e.target.value)} className={cls}>
          <option value="">–</option>
          {/* A stale id (user permanently deleted or no longer eligible) would
              otherwise render as no selection — show it explicitly so the admin
              knows to reassign. */}
          {value !== '' && !options.some((u) => u.id === value) && (
            <option value={value}>(deleted user)</option>
          )}
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (editType === 'select') {
    return (
      <label className="flex flex-col">
        {label}
        <select value={value} onChange={(e) => onChange(field, e.target.value)} className={cls}>
          <option value="">–</option>
          {(FIELD_SELECT_OPTIONS[field] ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (editType === 'textarea') {
    return (
      <label className="flex flex-col md:col-span-2">
        {label}
        <textarea rows={3} value={value} onChange={(e) => onChange(field, e.target.value)} className={`${cls} resize-y`} />
      </label>
    );
  }

  return (
    <label className="flex flex-col">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className={cls}
      />
    </label>
  );
}

// Multi-user PIC picker: a scrollable checkbox list of active users plus any
// dangling (permanently deleted) PIC already attached, so the admin can see and
// drop it. Mirrors the server rules (max 20, active users only).
function PicMultiSelect({
  value,
  users,
  existing,
  onChange,
}: {
  value: string[];
  users: AssignableUser[];
  existing: { id: string; name: string | null }[];
  onChange: (next: string[]) => void;
}) {
  const knownIds = new Set(users.map((u) => u.id));
  // Existing PIC rows whose user is gone (null name) or inactive (not in the
  // assignable list) still need a checkbox so they can be removed.
  const dangling = existing.filter((p) => !knownIds.has(p.id));

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="flex flex-col md:col-span-2">
      <span className="text-xs text-ink-muted">{FIELD_LABELS.pic_ids ?? 'Responsible PIC'}</span>
      <div
        className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded border border-border bg-white p-2 sm:grid-cols-2"
        role="group"
        aria-label="Responsible PIC"
      >
        {dangling.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm italic text-ink-muted">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name ?? '(deleted user)'}
          </label>
        ))}
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.name}
          </label>
        ))}
        {users.length === 0 && dangling.length === 0 && (
          <span className="text-sm text-ink-muted">No active users.</span>
        )}
      </div>
      <span className="mt-1 text-[11px] text-ink-muted">PICs get visibility and edit rights on this project.</span>
    </div>
  );
}

// Removed: folderIdFromInput (moved to UNUSED_DRIVE.md)
// Removed: FolderBadges (moved to UNUSED_DRIVE.md)

const PRIORITY_STYLES: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-success/30 bg-success-soft text-success',
  medium: 'border-warning/30 bg-warning-soft text-warning',
  high: 'border-danger/30 bg-danger-soft text-danger',
};

export function EditProjectModal({ project, users, isAdmin, onClose, onSave, onDelete, onNotice }: EditProjectModalProps) {
  const [draft, setDraft] = useState(() => toDraft(project));
  const [picIds, setPicIds] = useState<string[]>(() => (project.pics ?? []).map((p) => p.id));
  const [customerId, setCustomerId] = useState(project.customer_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SUPER_ADMIN selecting "Finish" on an on_progress project must first confirm
  // in a blocking modal — the draft only flips to finish on OK.
  const [stageFinishConfirm, setStageFinishConfirm] = useState(false);
  // SUPER_ADMIN deleting the project must confirm in a blocking modal too. The
  // delete is a hard delete, so the confirm modal stays open on failure and
  // shows the error inline.
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // STAFF must describe what changed before saving — wired into handleSave and
  // the Save button's disabled state below. SUPER_ADMIN edits never see it.
  const [updateProgress, setUpdateProgress] = useState('');

  // Removed: driveFolderId / linkInput / busy state (see UNUSED_DRIVE.md)

  // Vendor lines: a working copy of the project's lines plus any newly added
  // blank ones. Existing lines track their original values for diffing; lines
  // marked removed are collected in removedLineIds and DELETE'd on save.
  const originalLines = useMemo(() => {
    const map = new Map<string, ProjectVendorLine>();
    for (const line of project.vendors ?? []) map.set(line.id, line);
    return map;
  }, [project.vendors]);
  const [lines, setLines] = useState<VendorLineDraft[]>(() =>
    (project.vendors ?? []).map(toLineDraft),
  );
  const [removedLineIds, setRemovedLineIds] = useState<string[]>([]);

  // Removed: linkFolder / createFolder hooks (moved to UNUSED_DRIVE.md)
  const addVendorLine = useAddVendorLine(project.id);
  const updateVendorLine = useUpdateVendorLine(project.id);
  const removeVendorLine = useRemoveVendorLine(project.id);
  const thresholds = useAgingThresholds();
  const agingThresholds = thresholds.data ?? { low_max_days: 0, medium_max_days: 0 };

  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const setLineField = (key: string, keyId: string, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === keyId ? { ...l, [key]: value } : l)));

  const addBlankLine = () => {
    setLines((ls) => [...ls, blankLineDraft(ls.length)]);
  };

  const removeLine = (keyId: string, lineId?: string) => {
    if (lineId) setRemovedLineIds((ids) => [...ids, lineId]);
    setLines((ls) => ls.filter((l) => l.key !== keyId));
  };

  // Removed: handleLinkFolder (moved to UNUSED_DRIVE.md)
  // Removed: handleCreateFolder (moved to UNUSED_DRIVE.md)

  const sections = SECTION_ORDER.filter((s) => s !== 'Vendor lines').map((section) => ({
    section,
    fields: EDITABLE_FIELDS.filter(
      (key) =>
        (SECTION_OF[key] ?? 'Other') === section &&
        (key !== 'staff_assigned_id' || isAdmin) &&
        // PIC assignment is SUPER_ADMIN-only — it grants project visibility.
        (key !== 'pic_ids' || isAdmin) &&
        // Stage is SUPER_ADMIN-only — STAFF never sees a way to change it.
        (key !== 'current_stage' || isAdmin),
    ),
  })).filter((s) => s.fields.length > 0);

  const handleSelectStageFinish = () => setStageFinishConfirm(true);

  const handleConfirmStageFinish = () => {
    setField('current_stage', 'finish');
    setStageFinishConfirm(false);
  };

  const customerLabel = (): string | null => {
    if (customerId !== project.customer_id) return null; // changed in this modal
    return project.customer_id ? (project.customer_name ?? '(deleted customer)') : null;
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

  const vendorLineLabel = (line: VendorLineDraft): string | null => {
    if (!line.id) return null; // unsaved line — the picked name lives in the combobox
    const orig = originalLines.get(line.id);
    if (!orig) return null;
    if (line.vendor_id !== orig.vendor_id) return null; // changed in this modal
    return orig.vendor_name ?? '(deleted vendor)';
  };

  const linePriority = (line: VendorLineDraft): 'low' | 'medium' | 'high' | null =>
    computePriority(
      computeAging({
        project_sent_date: line.project_sent_date || null,
        approval_date: line.approval_date || null,
      }),
      agingThresholds,
    );

  const handleSave = async () => {
    if (saving) return;
    const changes: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key === 'pic_ids') continue; // handled separately (multi-user set)
      if (key === 'staff_assigned_id' && !isAdmin) continue;
      if (key === 'current_stage' && !isAdmin) continue;
      const current = normalize(key, draft[key] ?? '');
      const original = (project as unknown as Record<string, unknown>)[key] ?? null;
      if (current !== original) changes[key] = current;
    }
    // PICs are a full replacement set; only send when the admin actually changed
    // it (an omitted pic_ids must never wipe the project's PICs).
    if (isAdmin) {
      const originalPicIds = (project.pics ?? []).map((p) => p.id);
      const same =
        originalPicIds.length === picIds.length &&
        originalPicIds.every((id) => picIds.includes(id));
      if (!same) changes.pic_ids = picIds;
    }
    const currentCustomer = customerId || null;
    const originalCustomer = project.customer_id ?? null;
    if (currentCustomer !== originalCustomer) changes.customer_id = currentCustomer;

    if (Object.keys(changes).length === 0 && removedLineIds.length === 0 && lines.every((l) => l.id)) {
      onClose();
      return;
    }
    if (!isAdmin && !updateProgress.trim()) {
      setError('Update progress is required before saving.');
      return;
    }
    if (!isAdmin) changes.update_progress = updateProgress.trim();

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(changes).length > 0) {
        const res = await onSave(project, changes);
        if (!res.ok) {
          setError(res.message ?? 'Could not save changes.');
          return;
        }
      }

      // Vendor-line ops: new lines → POST, changed lines → PATCH, removed → DELETE.
      const ops: Promise<unknown>[] = [];
      for (const line of lines) {
        if (removedLineIds.includes(line.id ?? '')) continue;
        const vendorValue = (key: keyof VendorLineDraft) => normalizeVendorField(key, String(line[key] ?? ''));
        if (!line.id) {
          if (!line.vendor_id) continue; // blank, unsaved line
          const payload: Record<string, unknown> = {
            vendor_id: line.vendor_id,
            sort_order: line.sort_order,
          };
          for (const key of DELEGATED_VENDOR_FIELDS) payload[key] = vendorValue(key);
          ops.push(addVendorLine.mutateAsync(payload as never));
        } else {
          const orig = originalLines.get(line.id);
          if (!orig) continue;
          const patch: Record<string, unknown> = {};
          for (const key of DELEGATED_VENDOR_FIELDS) {
            const cur = vendorValue(key);
            const prev = (orig as unknown as Record<string, unknown>)[key] ?? null;
            if (cur !== prev) patch[key] = cur;
          }
          if (line.sort_order !== orig.sort_order) patch.sort_order = line.sort_order;
          if (Object.keys(patch).length > 0) {
            ops.push(updateVendorLine.mutateAsync({ id: line.id, changes: patch as never }));
          }
        }
      }
      for (const removed of removedLineIds) {
        ops.push(removeVendorLine.mutateAsync(removed));
      }

      if (ops.length > 0) await Promise.all(ops);

      onNotice?.('Saved.', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  // SUPER_ADMIN-only hard delete. The server rejects non-SUPER_ADMIN callers
  // with 403; this button is only ever rendered for admins.
  const handleDelete = async () => {
    if (deleting || !onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await onDelete(project);
      if (!res.ok) {
        setDeleteError(res.message ?? 'Could not delete project.');
        return;
      }
      onNotice?.('Project deleted.', 'success');
      setDeleteConfirm(false);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete project.');
    } finally {
      setDeleting(false);
    }
  };

  const renderBody = (): ReactNode => (
    <div className="px-5 py-4">
      {/* Removed: FolderBadges render (moved to UNUSED_DRIVE.md) */}
      {sections.map(({ section, fields }) => (
        <fieldset
          key={section}
          className={`mb-5 rounded border-2 p-3 ${
            section === 'Customer'
              ? 'border-emerald-300 bg-emerald-100/80 [&_input:not([type=\'date\'])]:bg-white [&_select]:bg-white [&_textarea]:bg-white [&_[data-date-field]]:bg-white'
              : 'border-border bg-canvas/60'
          }`}
        >
          <legend
            className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wide ${
              section === 'Customer' ? 'text-emerald-800' : 'text-ink-muted'
            }`}
          >
            {section}
          </legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {section === 'Customer' && (
              <label className="flex flex-col">
                <span className="text-xs text-ink-muted">{FIELD_LABELS.customer_id ?? 'Customer'}</span>
                <EntityCombobox
                  value={customerId}
                  valueLabel={customerLabel()}
                  onSelect={setCustomerId}
                  loadOptions={loadCustomers}
                  onCreate={createCustomer}
                  placeholder="Search or add customer"
                  ariaLabel="Customer"
                />
              </label>
            )}
            {fields.map((key) =>
              key === 'pic_ids' ? (
                <PicMultiSelect
                  key={key}
                  value={picIds}
                  users={users}
                  existing={project.pics ?? []}
                  onChange={setPicIds}
                />
              ) : key === 'current_stage' ? (
                <StageFieldInput
                  key={key}
                  value={draft[key] ?? ''}
                  projectStage={project.current_stage ?? 'on_progress'}
                  onSelectFinish={handleSelectStageFinish}
                  onChange={(value) => setField(key, value)}
                />
              ) : (
                <FieldInput key={key} field={key} value={draft[key] ?? ''} users={users} onChange={setField} />
              ),
            )}
          </div>
        </fieldset>
      ))}

      <fieldset className="mb-5 rounded border-2 border-indigo-300 bg-indigo-100/80 p-3 [&_input:not([type='date'])]:bg-white [&_select]:bg-white [&_textarea]:bg-white [&_[data-date-field]]:bg-white">
        <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-indigo-800">
          Vendor lines {lines.length > 0 && <span className="normal-case">({lines.length})</span>}
        </legend>
        {lines.length === 0 && (
          <p className="mb-2 text-xs text-ink-muted">No vendor lines yet — add one below.</p>
        )}
        <div className="space-y-4">
          {lines.map((line, index) => (
            <VendorLineRow
              key={line.key}
              line={line}
              index={index}
              priority={linePriority(line)}
              valueLabel={vendorLineLabel(line)}
              loadVendors={loadVendors}
              createVendor={createVendor}
              onChange={(key, value) => setLineField(key, line.key, value)}
              onSelectVendor={(id) => setLineField('vendor_id', line.key, id)}
              onRemove={() => removeLine(line.key, line.id)}
            />
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3 border-dashed" onClick={addBlankLine}>
          + Add vendor
        </Button>
      </fieldset>

      {!isAdmin && (
        <fieldset className="mb-5 rounded border border-warning/20 bg-warning-soft p-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">
            Update Progress <span className="normal-case font-normal">(required)</span>
          </legend>
          <textarea
            required
            rows={3}
            value={updateProgress}
            onChange={(e) => setUpdateProgress(e.target.value)}
            placeholder="Describe what you changed and why…"
            className="w-full rounded border border-warning/40 bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-warning/40"
            aria-label="Update progress"
          />
        </fieldset>
      )}
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
    </div>
  );

  return (
    <>
      <Modal
        ariaLabel={`Edit ${project.project_name}`}
        eyebrow="Edit project"
        title={project.project_name}
        // The shared Modal binds Escape on window, so a stacked confirm modal
        // would close this one too. Ignore Escape here while the delete
        // confirmation is open — the confirm modal handles it.
        onClose={deleteConfirm ? () => undefined : onClose}
        maxWidthClass="max-w-4xl"
        footer={
          <>
            {isAdmin && onDelete && (
              <Button
                variant="danger"
                className="mr-auto"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteConfirm(true);
                }}
                disabled={saving || deleting}
                data-testid="delete-project"
              >
                Delete
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !draft.project_name?.trim() || (!isAdmin && !updateProgress.trim())}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {renderBody()}
      </Modal>
      {stageFinishConfirm && (
        <StageConfirmModal
          projectName={project.project_name}
          onConfirm={handleConfirmStageFinish}
          onCancel={() => setStageFinishConfirm(false)}
        />
      )}
      {deleteConfirm && (
        <DeleteProjectConfirmModal
          projectName={project.project_name}
          vendorLineCount={(project.vendors ?? []).length}
          error={deleteError}
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteConfirm(false);
            setDeleteError(null);
          }}
        />
      )}
    </>
  );
}

export function VendorLineRow({
  line,
  index,
  priority,
  valueLabel,
  loadVendors,
  createVendor,
  onChange,
  onSelectVendor,
  onRemove,
}: {
  line: VendorLineDraft;
  index: number;
  priority: 'low' | 'medium' | 'high' | null;
  valueLabel: string | null;
  loadVendors: (q: string) => Promise<EntityOption[]>;
  createVendor: (name: string) => Promise<string>;
  onChange: (key: keyof VendorLineDraft, value: string) => void;
  onSelectVendor: (id: string) => void;
  onRemove: () => void;
}) {
  const cls = (v: unknown): string =>
    `w-full rounded border border-border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 ${
      v ? 'text-ink' : 'text-ink-muted'
    }`;
  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-muted">Vendor {index + 1}</span>
        <span className="flex items-center gap-2">
          {priority && (
            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}>
              {priority[0].toUpperCase() + priority.slice(1)}
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-danger/20 px-2 py-0.5 text-xs text-danger hover:bg-danger-soft"
          >
            Remove
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="flex flex-col md:col-span-2">
          <span className="text-xs text-ink-muted">Vendor</span>
          <EntityCombobox
            value={line.vendor_id}
            valueLabel={valueLabel}
            onSelect={onSelectVendor}
            loadOptions={loadVendors}
            onCreate={createVendor}
            placeholder="Search or add vendor"
            ariaLabel={`Vendor ${index + 1}`}
          />
        </label>
        {VENDOR_LINE_FIELDS.map((f) => {
          const labelEl = <span className="text-xs text-ink-muted">{f.label}</span>;
          if (f.type === 'select') {
            return (
              <label key={f.key} className="flex flex-col">
                {labelEl}
                <select value={line[f.key] as string} onChange={(e) => onChange(f.key, e.target.value)} className={cls(line[f.key])}>
                  <option value="">–</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (f.type === 'date') {
            return (
              <label key={f.key} className="flex flex-col">
                {labelEl}
                <DateField value={line[f.key] as string} onChange={(v) => onChange(f.key, v)} ariaLabel={f.label} />
              </label>
            );
          }
          if (f.type === 'number') {
            return (
              <label key={f.key} className="flex flex-col">
                {labelEl}
                <PriceField value={line[f.key] as string} onChange={(v) => onChange(f.key, v)} ariaLabel={f.label} />
              </label>
            );
          }
          return (
            <label key={f.key} className="flex flex-col">
              {labelEl}
              <input
                type="text"
                value={line[f.key] as string}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={cls(line[f.key])}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}