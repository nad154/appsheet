import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Project, ProjectStage, ProjectVendorLine } from '@tracker/shared';
import { computeAging, computePriority } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import { useAgingThresholds } from '../../hooks/useSettings';
import { formatGridDate, formatGridNumber } from '../../lib/format';
import {
  useAddVendorLine,
  useUpdateVendorLine,
  useRemoveVendorLine,
} from '../../hooks/useProjectVendors';
import { apiClient } from '../../lib/api-client';
import { EntityCombobox, type EntityOption } from '../EntityCombobox';
import { useToast } from '../Toast';
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
import type { EditResult } from './ProjectTable';
import type { ToastVariant } from '../Toast';

interface EditProjectModalProps {
  project: Project;
  users: AssignableUser[];
  isAdmin: boolean;
  onClose: () => void;
  onSave: (row: Project, changes: Record<string, unknown>) => Promise<EditResult>;
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
  { key: 'vendor_type', label: 'Vendor type', type: 'select', options: FIELD_SELECT_OPTIONS.vendor_type },
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
  const label = <span className="text-xs text-gray-600">{FIELD_LABELS.current_stage}</span>;
  const cls =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';

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
      className={`mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 ${
        display ? 'text-gray-800' : 'text-gray-400'
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
// field opens the native date picker via a hidden input, and ✕ clears it. The
// draft stays YYYY-MM-DD.
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
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // fall through to click
      }
    }
    el.click();
    el.focus();
  };

  return (
    <div className="mt-1 flex w-full items-center rounded border border-gray-300 px-2 py-1">
      <button
        type="button"
        onClick={openPicker}
        title={display || 'Pick a date'}
        className={`flex flex-1 cursor-pointer items-center justify-between gap-2 text-left text-sm focus:outline-none ${
          display ? 'text-gray-800' : 'text-gray-400'
        }`}
      >
        {display || '—'}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 text-gray-400"
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
          onClick={() => onChange('')}
          aria-label="Clear date"
          title="Clear date"
          className="ml-1 rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
        className="sr-only"
        tabIndex={-1}
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
  const label = <span className="text-xs text-gray-600">{FIELD_LABELS[field] ?? field}</span>;
  // Empty fields render their value/placeholder in light gray so a null/blank
  // field reads as empty instead of looking like plain dark text.
  const cls = `mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${
    value ? 'text-gray-800' : 'text-gray-400'
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
    return (
      <label className="flex flex-col">
        {label}
        <select value={value} onChange={(e) => onChange(field, e.target.value)} className={cls}>
          <option value="">–</option>
          {users.map((u) => (
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

// Mirrors driveService.extractFolderId for display state only — shows the newly
// linked folder in the modal without a refetch. The server remains the single
// authority for the actual link.
function folderIdFromInput(input: string): string {
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const raw = match ? match[1] : input.trim();
  const qIdx = raw.indexOf('?');
  return qIdx === -1 ? raw : raw.slice(0, qIdx);
}

function FolderBadges({
  project,
  isAdmin,
  driveFolderId,
  linkInput,
  busy,
  onLinkInput,
  onLinkFolder,
  onCreateFolder,
}: {
  project: Project;
  isAdmin: boolean;
  driveFolderId: string | null;
  linkInput: string;
  busy: 'link' | 'create' | null;
  onLinkInput: (value: string) => void;
  onLinkFolder: () => void;
  onCreateFolder: () => void;
}) {
  const folderName = project.folder_name;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-gray-400">
        Folder:{' '}
        {driveFolderId ? (
          <a
            href={`https://drive.google.com/drive/folders/${driveFolderId}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            {folderName || 'open Drive'}
          </a>
        ) : (
          folderName || '—'
        )}
      </span>
      {isAdmin && (
        <>
          <span className="flex items-center gap-1">
            <input
              type="text"
              value={linkInput}
              onChange={(e) => onLinkInput(e.target.value)}
              placeholder="Drive folder URL or ID"
              aria-label="Drive folder URL or ID"
              className="w-48 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="button"
              onClick={onLinkFolder}
              disabled={busy !== null || !linkInput.trim()}
              className="rounded border border-blue-300 px-2 py-0.5 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              {busy === 'link' ? 'Linking…' : 'Link existing folder'}
            </button>
          </span>
          <button
            type="button"
            onClick={onCreateFolder}
            disabled={busy !== null}
            className="rounded bg-blue-600 px-2 py-0.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'create' ? 'Creating…' : 'Create folder'}
          </button>
        </>
      )}
    </div>
  );
}

const PRIORITY_STYLES: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-green-300 bg-green-100 text-green-800',
  medium: 'border-amber-300 bg-amber-100 text-amber-800',
  high: 'border-red-300 bg-red-100 text-red-800',
};

export function EditProjectModal({ project, users, isAdmin, onClose, onSave, onNotice }: EditProjectModalProps) {
  const [draft, setDraft] = useState(() => toDraft(project));
  const [customerId, setCustomerId] = useState(project.customer_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SUPER_ADMIN selecting "Finish" on an on_progress project must first confirm
  // in a blocking modal — the draft only flips to finish on OK.
  const [stageFinishConfirm, setStageFinishConfirm] = useState(false);
  // STAFF must describe what changed before saving — wired into handleSave and
  // the Save button's disabled state below. SUPER_ADMIN edits never see it.
  const [updateProgress, setUpdateProgress] = useState('');

  const [driveFolderId, setDriveFolderId] = useState<string | null>(project.drive_folder_id ?? null);
  const [linkInput, setLinkInput] = useState('');
  const [busy, setBusy] = useState<'link' | 'create' | null>(null);

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

  const linkFolder = useLinkFolder();
  const createFolder = useCreateFolder();
  const addVendorLine = useAddVendorLine(project.id);
  const updateVendorLine = useUpdateVendorLine(project.id);
  const removeVendorLine = useRemoveVendorLine(project.id);
  const thresholds = useAgingThresholds();
  const agingThresholds = thresholds.data ?? { low_max_days: 0, medium_max_days: 0 };
  const { showToast } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const handleLinkFolder = async () => {
    if (busy || !linkInput.trim()) return;
    setBusy('link');
    try {
      await linkFolder.mutateAsync({ projectId: project.id, folderInput: linkInput.trim() });
      setDriveFolderId(folderIdFromInput(linkInput.trim()));
      setLinkInput('');
      showToast('Folder linked.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not link folder.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateFolder = async () => {
    if (busy) return;
    setBusy('create');
    try {
      const result = await createFolder.mutateAsync({ projectId: project.id });
      setDriveFolderId(result.folderId);
      showToast('Folder created.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create folder.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sections = SECTION_ORDER.filter((s) => s !== 'Vendor lines').map((section) => ({
    section,
    fields: EDITABLE_FIELDS.filter(
      (key) =>
        (SECTION_OF[key] ?? 'Other') === section &&
        (key !== 'staff_assigned_id' || isAdmin) &&
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
      if (key === 'staff_assigned_id' && !isAdmin) continue;
      if (key === 'current_stage' && !isAdmin) continue;
      const current = normalize(key, draft[key] ?? '');
      const original = (project as unknown as Record<string, unknown>)[key] ?? null;
      if (current !== original) changes[key] = current;
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

  const renderBody = (): ReactNode => (
    <div className="px-5 py-4">
      <FolderBadges
        project={project}
        isAdmin={isAdmin}
        driveFolderId={driveFolderId}
        linkInput={linkInput}
        busy={busy}
        onLinkInput={setLinkInput}
        onLinkFolder={handleLinkFolder}
        onCreateFolder={handleCreateFolder}
      />
      {sections.map(({ section, fields }) => (
        <fieldset key={section} className="mb-5">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{section}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {section === 'Customer' && (
              <label className="flex flex-col">
                <span className="text-xs text-gray-600">{FIELD_LABELS.customer_id ?? 'Customer'}</span>
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
              key === 'current_stage' ? (
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

      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Vendor lines {lines.length > 0 && <span className="normal-case">({lines.length})</span>}
        </legend>
        {lines.length === 0 && (
          <p className="mb-2 text-xs text-gray-400">No vendor lines yet — add one below.</p>
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
        <button
          type="button"
          onClick={addBlankLine}
          className="mt-3 rounded border border-dashed border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
        >
          + Add vendor
        </button>
      </fieldset>

      {!isAdmin && (
        <fieldset className="mb-5 rounded border border-amber-200 bg-amber-50 p-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Update Progress <span className="normal-case font-normal">(required)</span>
          </legend>
          <textarea
            required
            rows={3}
            value={updateProgress}
            onChange={(e) => setUpdateProgress(e.target.value)}
            placeholder="Describe what you changed and why…"
            className="w-full rounded border border-amber-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
            aria-label="Update progress"
          />
        </fieldset>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !draft.project_name?.trim() || (!isAdmin && !updateProgress.trim())}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Edit project</p>
            <h2 className="text-base font-semibold text-gray-800">{project.project_name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>
        {renderBody()}
      </div>
      {stageFinishConfirm && (
        <StageConfirmModal
          projectName={project.project_name}
          onConfirm={handleConfirmStageFinish}
          onCancel={() => setStageFinishConfirm(false)}
        />
      )}
    </div>,
    document.body,
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
    `w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${
      v ? 'text-gray-800' : 'text-gray-400'
    }`;
  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">Vendor {index + 1}</span>
        <span className="flex items-center gap-2">
          {priority && (
            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}>
              {priority[0].toUpperCase() + priority.slice(1)}
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="flex flex-col md:col-span-2">
          <span className="text-xs text-gray-600">Vendor</span>
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
          const labelEl = <span className="text-xs text-gray-600">{f.label}</span>;
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