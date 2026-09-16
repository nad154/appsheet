import { useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import { useToast } from '../Toast';
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

// Mirrors driveService.extractFolderId for display state only — shows the newly
// linked folder in the modal without a refetch. The server remains the single
// authority for the actual link.
function folderIdFromInput(input: string): string {
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const raw = match ? match[1] : input.trim();
  const qIdx = raw.indexOf('?');
  return qIdx === -1 ? raw : raw.slice(0, qIdx);
}

function ReadOnlyBadges({
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
  const priority = project.priority;
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

export function EditProjectModal({ project, users, isAdmin, onClose, onSave, onNotice }: EditProjectModalProps) {
  const [draft, setDraft] = useState(() => toDraft(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // STAFF must describe what changed before saving — wired into handleSave and
  // the Save button's disabled state below. SUPER_ADMIN edits never see it.
  const [updateProgress, setUpdateProgress] = useState('');

  const [driveFolderId, setDriveFolderId] = useState<string | null>(project.drive_folder_id ?? null);
  const [linkInput, setLinkInput] = useState('');
  const [busy, setBusy] = useState<'link' | 'create' | null>(null);

  const linkFolder = useLinkFolder();
  const createFolder = useCreateFolder();
  const { showToast } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

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
    if (!isAdmin && !updateProgress.trim()) {
      setError('Update progress is required before saving.');
      return;
    }
    if (!isAdmin) changes.update_progress = updateProgress.trim();
    setSaving(true);
    setError(null);
    try {
      const res = await onSave(project, changes);
      if (res.ok) {
        onNotice?.('Saved.', 'success');
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
      <ReadOnlyBadges
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
            {fields.map((key) => (
              <FieldInput key={key} field={key} value={draft[key] ?? ''} users={users} onChange={setField} />
            ))}
          </div>
        </fieldset>
      ))}
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