import { useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
import {
  FIELD_LABELS,
  FIELD_SELECT_OPTIONS,
  FIELD_TYPES,
  NUMBER_FIELDS,
  SECTION_OF,
  SECTION_ORDER,
} from '../../lib/projectFields';
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

// Every editable field, in FIELD_TYPES order. Computed/system fields (id,
// created_at, updated_at, drive_folder_id, staff_assigned_name, pic_name,
// priority) are deliberately excluded — never sent on save.
const EDITABLE_FIELDS = Object.keys(FIELD_TYPES);

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

// Duplicated from the inline grid editor on purpose (see planning_ex9.md
// Implementation Notes, decision #2) — the modal uses onChange-driven controls
// rather than commit-on-blur, so it doesn't share an EditableCell.
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
  const cls =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';

  if (editType === 'date') {
    return (
      <label className="flex flex-col">
        {label}
        <input type="date" value={value} onChange={(e) => onChange(field, e.target.value)} className={cls} />
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
        type={editType === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className={cls}
      />
    </label>
  );
}

function ReadOnlyBadges({ project }: { project: Project }) {
  const priority = project.priority;
  const urn = project.drive_folder_id;
  const folderName = project.folder_name;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      {priority && (
        <span
          className={`inline-block rounded-full border px-2 py-0.5 font-medium ${
            priority === 'high'
              ? 'border-red-300 bg-red-100 text-red-800'
              : priority === 'medium'
                ? 'border-amber-300 bg-amber-100 text-amber-800'
                : 'border-green-300 bg-green-100 text-green-800'
          }`}
        >
          Priority: {priority[0].toUpperCase() + priority.slice(1)}
        </span>
      )}
      <span className="text-gray-400">
        Folder:{' '}
        {urn ? (
          <a
            href={`https://drive.google.com/drive/folders/${urn}`}
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
    </div>
  );
}

export function EditProjectModal({ project, users, isAdmin, onClose, onSave, onNotice }: EditProjectModalProps) {
  const [draft, setDraft] = useState(() => toDraft(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const sections = SECTION_ORDER.map((section) => ({
    section,
    fields: EDITABLE_FIELDS.filter(
      (key) => (SECTION_OF[key] ?? 'Other') === section && (key !== 'staff_assigned_id' || isAdmin),
    ),
  })).filter((s) => s.fields.length > 0);

  const handleSave = async () => {
    if (saving) return;
    const changes: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key === 'staff_assigned_id' && !isAdmin) continue;
      const current = normalize(key, draft[key] ?? '');
      const original = (project as unknown as Record<string, unknown>)[key] ?? null;
      if (current !== original) changes[key] = current;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await onSave(project, changes);
      if (res.ok) {
        onNotice?.(res.pending ? 'Change submitted for approval.' : 'Saved.', 'success');
        onClose();
      } else {
        setError(res.message ?? 'Could not save changes.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const renderBody = (): ReactNode => (
    <div className="px-5 py-4">
      <ReadOnlyBadges project={project} />
      {sections.map(({ section, fields }) => (
        <fieldset key={section} className="mb-5">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{section}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {fields.map((key) => (
              <FieldInput key={key} field={key} value={draft[key] ?? ''} users={users} onChange={setField} />
            ))}
          </div>
        </fieldset>
      ))}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !draft.project_name?.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-800">Edit project — {project.project_name}</h2>
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
    </div>
  );
}