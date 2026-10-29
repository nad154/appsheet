import { useMemo, useState } from 'react';
import type { Project, ProjectIssueEntry } from '@tracker/shared';
import type { AssignableUser } from '../../hooks/useProjects';
import { useProjectIssues, useAddIssue } from '../../hooks/useProjectIssues';
import { ApiError } from '../../lib/api-client';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { controlClass } from '../ui/Input';
import { peopleSummary } from './columns';

// Same cap the API enforces (MAX_ISSUE_ASSIGNEES in @tracker/shared).
const MAX_ASSIGNEES = 20;

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
  const assignees = entry.assignees ?? [];
  const summary = assignees.length > 0 ? peopleSummary(assignees) : null;
  return (
    <div className="rounded border border-border p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{fmtDate(entry.issue_date)}</span>
        <span className="text-xs text-ink-muted">
          {entry.created_by_name ?? 'Admin'} · {fmtDateTime(entry.created_at)}
        </span>
      </div>
      <p className="text-sm text-ink">{entry.issue_text}</p>
      <p className="mt-1 text-xs text-ink-muted" title={summary?.full ?? undefined}>
        Assigned to: {summary ? summary.display : '—'}
      </p>
    </div>
  );
}

// One row of the assignee checklist. The project's Sales + every PIC, de-duped.
// A user who is both is tagged with both roles.
type AssigneeCandidate = { id: string; name: string; isSales: boolean; isPic: boolean };

export function IssuesModal({
  project,
  users,
  onClose,
}: {
  project: Project | null;
  users: AssignableUser[];
  onClose: () => void;
}) {
  // Only the project's Sales + PICs may be assigned, and only while active. The
  // server enforces this independently — this list is just the UI affordance.
  const candidates = useMemo<AssigneeCandidate[]>(() => {
    if (!project) return [];
    const byId = new Map<string, AssigneeCandidate>();
    const ensure = (id: string, name: string | null | undefined): AssigneeCandidate => {
      const existing = byId.get(id);
      if (existing) return existing;
      const created: AssigneeCandidate = { id, name: name ?? '(deleted user)', isSales: false, isPic: false };
      byId.set(id, created);
      return created;
    };
    if (project.staff_assigned_id) {
      ensure(project.staff_assigned_id, project.staff_assigned_name).isSales = true;
    }
    for (const pic of project.pics ?? []) {
      ensure(pic.id, pic.name).isPic = true;
    }
    // Deleted/inactive users are not assignable, so they never appear here.
    const activeIds = new Set(users.map((u) => u.id));
    return [...byId.values()].filter((c) => activeIds.has(c.id));
  }, [project, users]);

  const [issueText, setIssueText] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // Email defaults ON so the common case ("notify the assignees") needs no extra
  // click; it is forced off when nobody is selected.
  const [sendEmail, setSendEmail] = useState(true);
  const [addError, setAddError] = useState<string | null>(null);
  const addIssue = useAddIssue(project?.id ?? '');
  const { data, isLoading, isError } = useProjectIssues(project?.id ?? null);

  if (!project) return null;

  const emailEnabled = assigneeIds.length > 0;
  const canAdd = !!issueText.trim() && !addIssue.isPending;

  const toggleAssignee = (id: string) =>
    setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]));

  const handleAdd = async () => {
    const text = issueText.trim();
    if (!text || addIssue.isPending) return;
    setAddError(null);
    try {
      await addIssue.mutateAsync({
        issue_text: text,
        issue_date: issueDate || undefined,
        assignee_ids: assigneeIds,
        send_email: assigneeIds.length > 0 && sendEmail,
      });
      setIssueText('');
      setIssueDate(todayIso());
      setAssigneeIds([]);
      setSendEmail(true);
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Could not add the issue.');
    }
  };

  return (
    <Modal
      ariaLabel={`Issues — ${project.project_name}`}
      eyebrow="Issues"
      title={project.project_name}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4 px-5 py-4">
        <fieldset className="rounded border border-border p-3">
          <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Add issue</legend>
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Issue
              <textarea
                rows={3}
                value={issueText}
                onChange={(e) => setIssueText(e.target.value)}
                placeholder="Describe the issue…"
                className={controlClass}
                aria-label="Issue text"
              />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Date
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className={controlClass}
                  aria-label="Issue date"
                />
              </label>
              <div className="flex flex-col gap-1 text-xs text-ink-muted">
                <span>
                  Assignees{' '}
                  <span className="text-[11px] text-ink-muted/80">
                    ({assigneeIds.length}/{MAX_ASSIGNEES})
                  </span>
                </span>
                <div
                  className="max-h-40 overflow-y-auto rounded border border-border bg-white p-2"
                  role="group"
                  aria-label="Issue assignees"
                >
                  {candidates.length === 0 && (
                    <span className="text-sm text-ink-muted">No Sales or PIC assigned to this project.</span>
                  )}
                  {candidates.map((c) => {
                    const atCap = !assigneeIds.includes(c.id) && assigneeIds.length >= MAX_ASSIGNEES;
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 text-sm ${atCap ? 'text-ink-muted/60' : 'text-ink'}`}
                      >
                        <input
                          type="checkbox"
                          checked={assigneeIds.includes(c.id)}
                          disabled={atCap}
                          onChange={() => toggleAssignee(c.id)}
                        />
                        <span>{c.name}</span>
                        <span className="text-[11px] text-ink-muted">
                          {c.isSales ? 'Sales' : ''}
                          {c.isSales && c.isPic ? ' · ' : ''}
                          {c.isPic ? 'PIC' : ''}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <label
              className={`flex items-center gap-2 text-sm ${emailEnabled ? 'text-ink' : 'text-ink-muted/60'}`}
              title={emailEnabled ? undefined : 'Select at least one assignee to send an email'}
            >
              <input
                type="checkbox"
                checked={emailEnabled && sendEmail}
                disabled={!emailEnabled}
                onChange={(e) => setSendEmail(e.target.checked)}
                aria-label="Send email to assignees"
              />
              Send email to assignees
            </label>
            {addError && <p className="text-sm text-danger">{addError}</p>}
            <Button onClick={handleAdd} disabled={!canAdd}>
              {addIssue.isPending ? 'Adding…' : 'Add issue'}
            </Button>
          </div>
        </fieldset>

        {isLoading && <p className="text-sm text-ink-muted">Loading issues…</p>}
        {isError && <p className="text-sm text-danger">Could not load issues.</p>}
        {!isLoading && !isError && (data?.entries.length ?? 0) === 0 && (
          <p className="text-sm text-ink-muted">No issues recorded for this project yet.</p>
        )}
        {data?.entries.map((entry) => <IssueCard key={entry.id} entry={entry} />)}
      </div>
    </Modal>
  );
}
