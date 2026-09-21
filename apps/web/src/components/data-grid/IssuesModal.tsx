import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project, ProjectIssueEntry } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
import { useProjectIssues, useAddIssue } from '../../hooks/useProjectIssues';
import { ApiError } from '../../lib/api-client';

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function fmtDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function IssueCard({ entry }: { entry: ProjectIssueEntry }) {
  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800">{fmtDate(entry.issue_date)}</span>
        <span className="text-xs text-gray-400">
          {entry.created_by_name ?? 'Admin'} · {fmtDateTime(entry.created_at)}
        </span>
      </div>
      <p className="text-sm text-gray-700">{entry.issue_text}</p>
      <p className="mt-1 text-xs text-gray-500">Assigned to: {entry.assignee_name ?? '—'}</p>
    </div>
  );
}

export function IssuesModal({
  project,
  users,
  onClose,
}: {
  project: Project | null;
  users: AssignableUser[];
  onClose: () => void;
}) {
  // Only STAFF can be attached to an issue.
  const staff = useMemo(() => users.filter((u) => u.role === 'STAFF'), [users]);
  const [issueText, setIssueText] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [assigneeId, setAssigneeId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addIssue = useAddIssue(project?.id ?? '');
  const { data, isLoading, isError } = useProjectIssues(project?.id ?? null);

  if (!project) return null;

  const handleAdd = async () => {
    const text = issueText.trim();
    if (!text || addIssue.isPending) return;
    setAddError(null);
    try {
      await addIssue.mutateAsync({
        issue_text: text,
        issue_date: issueDate || undefined,
        assignee_id: assigneeId || null,
      });
      setIssueText('');
      setAssigneeId('');
      setIssueDate(todayIso());
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Could not add the issue.');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Issues — ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Issues</p>
            <h2 className="text-base font-semibold text-gray-800">{project.project_name}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <fieldset className="rounded border border-gray-200 p-3">
            <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Add issue</legend>
            <div className="space-y-3">
              <label className="flex flex-col text-xs text-gray-600">
                Issue
                <textarea
                  rows={3}
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  placeholder="Describe the issue…"
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  aria-label="Issue text"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col text-xs text-gray-600">
                  Date
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    aria-label="Issue date"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-600">
                  Assign to staff
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    aria-label="Assign to staff"
                  >
                    <option value="">–</option>
                    {staff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <button
                type="button"
                onClick={handleAdd}
                disabled={!issueText.trim() || addIssue.isPending}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {addIssue.isPending ? 'Adding…' : 'Add issue'}
              </button>
            </div>
          </fieldset>

          {isLoading && <p className="text-sm text-gray-500">Loading issues…</p>}
          {isError && <p className="text-sm text-red-600">Could not load issues.</p>}
          {!isLoading && !isError && (data?.entries.length ?? 0) === 0 && (
            <p className="text-sm text-gray-400">No issues recorded for this project yet.</p>
          )}
          {data?.entries.map((entry) => <IssueCard key={entry.id} entry={entry} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}