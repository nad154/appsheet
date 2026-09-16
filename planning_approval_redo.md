# Planning: Remove Approval Workflow, Add STAFF Update-Progress Log

## Goal

1. STAFF writes apply **immediately** (no more `pending_edits` / SUPER_ADMIN approval queue).
2. STAFF can no longer edit cells inline in the grid ("excel sheet" behavior). Clicking a
   STAFF-owned row opens a modal (same shape as the existing admin `EditProjectModal`) with a
   **mandatory "Update Progress"** textarea. Save is blocked until it's filled in.
3. Every STAFF save writes a row to a new `project_updates` history table (old/new values per
   changed field + the update-progress text + who + when).
4. A new **"Update Progress"** column appears at the far right of the grid, showing the latest
   `update_progress` string for that project, with a yellow "unread" dot when STAFF has made a
   change SUPER_ADMIN hasn't seen yet.
5. SUPER_ADMIN clicking that cell opens a history modal: project name header, newest-first list of
   past updates, each showing STAFF name, timestamp, an old→new diff table, and the update-progress
   text for that entry. Opening it clears the unread dot for that project.

## Decisions locked in (flag if you disagree before Phase 3)

- `pending_edits` table and all approval code/UI are **deleted**, not just unused. If you want the
  historical approval data preserved, export `pending_edits.parquet` before Phase 1 runs — the
  migration doesn't back it up.
- STAFF project **creation** stays a direct write (like SUPER_ADMIN today) and does **not** require
  `update_progress` — there's nothing to describe yet. Only **updates to existing rows** require it.
- Only STAFF-submitted edits get logged to `project_updates`. SUPER_ADMIN's own direct edits are not
  logged (matches "STAFF name" always appearing in the history spec). Easy to extend later if you
  want admin edits logged too.
- Unread state is a single shared flag per project (`is_read` on each `project_updates` row), not
  per-admin-user. With a small number of SUPER_ADMINs this matches "similar to an unread
  notification" well enough without adding a second per-user read-tracking table. If you later add
  many admins and want per-admin unread state, that's a follow-up.
- Opening the history modal (`GET /api/projects/:id/updates`) **marks everything read as a side
  effect** in the same request — no separate "mark read" click.
- The existing `NEW_APPROVAL` notification type stops being inserted (nothing produces it anymore).
  Leaving the enum value in the `notifications` CHECK constraint is harmless; not worth a migration.

---

## Phase 1 — Schema: add `project_updates`, retire `pending_edits`

**File: `apps/server/src/db/migrate.ts`**

Add to `DDL`:

```sql
CREATE TABLE IF NOT EXISTS project_updates (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,        -- FK dropped, same convention as other tables
  staff_id VARCHAR NOT NULL,          -- FK dropped
  changes_json VARCHAR NOT NULL,      -- JSON: { [field]: { old: unknown, new: unknown } }
  update_progress VARCHAR NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);
```

Drop the old table. Add a one-time migration step (idempotent, same pattern as `migrateColumns`):

```ts
async function dropPendingEdits(): Promise<void> {
  if (await tableExists('pending_edits')) {
    await runWrite(async (exec) => {
      await exec(`DROP TABLE pending_edits`);
    });
  }
}
```

Call it from `migrate()` after `await migrateColumns();`.

Also remove the `pending_edits.parquet` entry from `importLegacySnapshots()`'s `mapping`, and add:

```ts
'project_updates.parquet': { table: 'project_updates' },
```

**File: `apps/server/src/db/export.ts`**

- Add `'project_updates'` to the `Array<'projects' | 'pending_edits' | 'users'>` union → replace
  `'pending_edits'` with `'project_updates'` everywhere in this file (type union, `copyStatements`
  map, `readSnapshot`'s file union).
- `copyStatements.project_updates = \`COPY project_updates TO '${parquetPath('project_updates.parquet')}' (FORMAT PARQUET)\`;`

**Gate:** `npm run typecheck -w @tracker/server`. Run `npm run dev:server` once locally to confirm
`migrate()` runs clean against an existing dev DB (drops `pending_edits`, creates
`project_updates`) — check server log for errors, then stop it.

---

## Phase 2 — Shared types (`packages/shared`)

**File: `packages/shared/src/schemas/pendingEdit.ts`** — delete this file. Remove its export line
from `packages/shared/src/index.ts` (`export * from './schemas/pendingEdit.js';`).

**New file: `packages/shared/src/schemas/projectUpdate.ts`**

```ts
import { z } from 'zod';

// One changed field, captured as an old/new pair at the moment of the update.
export const projectUpdateFieldDiffSchema = z.object({
  old: z.unknown(),
  new: z.unknown(),
});

export const projectUpdateEntrySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  staff_name: z.string(),
  changes: z.record(z.string(), projectUpdateFieldDiffSchema),
  update_progress: z.string(),
  is_read: z.boolean(),
  created_at: z.string().datetime(),
});
export type ProjectUpdateEntry = z.infer<typeof projectUpdateEntrySchema>;

// GET /api/projects/:id/updates response.
export const projectUpdateHistorySchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string(),
  entries: z.array(projectUpdateEntrySchema),
});
export type ProjectUpdateHistory = z.infer<typeof projectUpdateHistorySchema>;

// Required field bundled into a STAFF PATCH /api/projects/:id body, alongside
// the normal changed project fields. Stripped out server-side before the rest
// of the body is validated against projectUpdateSchema.
export const updateProgressFieldSchema = z.object({
  update_progress: z.string().trim().min(1, 'Update progress is required'),
});
```

Add `export * from './schemas/projectUpdate.js';` to `packages/shared/src/index.ts`.

**File: `packages/shared/src/schemas/project.ts`**

Add two server-computed, read-only fields to `projectSchema` (same treatment as `priority` —
present on reads, excluded from create/update):

```ts
  // Latest STAFF update-progress note + whether SUPER_ADMIN has seen it yet.
  // Derived from project_updates at query time — never submitted by the client.
  update_progress: z.string().nullable().optional(),
  has_unread_update: z.boolean().optional(),
```

Add both to the `.omit({...})` list in `projectCreateSchema` (right next to `priority: true`).

**Gate:** `npm run build -w @tracker/shared && npm run typecheck -w @tracker/shared`.

---

## Phase 3 — Server: unify create/update, delete the pending-edits module

**Delete:** `apps/server/src/modules/pending-edits/` (both `routes.ts` and
`pendingEditsService.ts`).

**File: `apps/server/src/modules/projects/projectsService.ts`**

Move ownership/authorization rules that used to live in `submitCreate`/`submitUpdate` here as
shared helpers, since both roles now go through one write path:

```ts
export class ProjectWriteError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectWriteError';
  }
}

/** STAFF may only ever own/target their own projects, and can never reassign Sales. */
export function assertStaffOwnership(
  user: AuthUser,
  existing: { staff_assigned_id: string | null } | null,
  payload: { staff_assigned_id?: string | null },
): void {
  if (user.role !== 'STAFF') return;
  if (existing && existing.staff_assigned_id !== user.id) {
    throw new ProjectWriteError('Cannot edit a project assigned to another staff member', 403);
  }
  if (payload.staff_assigned_id && payload.staff_assigned_id !== user.id) {
    throw new ProjectWriteError('Cannot assign or reassign a project to another staff member', 403);
  }
}
```

**File: `apps/server/src/modules/pending-edits/pendingEditsService.ts` logic to relocate** — move
`createDirect`, `updateDirect`, `deleteProject`, plus `PROJECT_COLUMNS`/`insertProjectSql`/
`buildInsertValues`, into `apps/server/src/modules/projects/projectsService.ts` (or a new
sibling `projectsWriteService.ts` if you'd rather keep `projectsService.ts` read-only — either is
fine, just update imports accordingly). Rename to drop the "Direct" suffix since there's no other
mode anymore: `createProject`, `updateProject`, `deleteProject`.

`createProject(user, rawPayload)`:
- Runs for **both** roles now. Validate with `projectCreateSchema`. If STAFF and
  `payload.staff_assigned_id` unset, default it to `user.id` (old `submitCreate` behavior); if set
  to someone else, throw via `assertStaffOwnership`.
- Keep the existing Drive-folder-on-create behavior (`isGoogleConfigured()` +
  `createProjectFolder`) exactly as `createDirect` had it.

`updateProject(user, projectId, rawPayload, updateProgress?: string)`:
- Fetch the existing project first (needed for the diff regardless of role).
- Validate `rawPayload` with `projectUpdateSchema` (after `update_progress` has already been
  stripped by the route handler — see Phase 3.1).
- Call `assertStaffOwnership(user, existing, payload)`.
- Compute the SQL `UPDATE ... SET` exactly as `updateDirect` did.
- **If `user.role === 'STAFF'`:** `updateProgress` is required here (route already enforced it via
  Zod, but throw `ProjectWriteError('Update progress is required', 400)` defensively if missing).
  Inside the same `runWrite` transaction as the `UPDATE`, also insert a `project_updates` row:
  build `changes_json` as `{ [field]: { old: existing[field], new: value } }` for every field
  actually being set. Call `recordProjectUpdate` from the new module (Phase 4) — pass the open
  `ex` executor through rather than opening a second `runWrite`, so it's one transaction.
- Keep the `exportSnapshots(['projects'])` call after the write commits.

`deleteProject`: unchanged, just relocated. Drop its `DELETE FROM pending_edits WHERE project_id = ?`
line since that table no longer exists.

**File: `apps/server/src/modules/projects/routes.ts`**

Simplify — no more role branching on POST/PATCH status codes:

```ts
projectsRouter.post('/', async (req, res) => {
  try {
    const result = await createProject(req.user!, req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(err, res);
  }
});

projectsRouter.patch('/:id', async (req, res) => {
  const user = req.user!;
  const { id } = idParamSchema.parse(req.params);
  try {
    let updateProgress: string | undefined;
    let body = req.body;
    if (user.role === 'STAFF') {
      const { update_progress } = updateProgressFieldSchema.parse(req.body);
      updateProgress = update_progress;
      const { update_progress: _drop, ...rest } = req.body;
      body = rest;
    }
    await updateProject(user, id, body, updateProgress);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});
```

Update `handleError` to catch `ProjectWriteError` instead of `PendingEditError`. Import
`updateProgressFieldSchema` from `@tracker/shared`.

**Gate:** `npm run typecheck -w @tracker/server`.

---

## Phase 4 — Server: `project-updates` module

**New file: `apps/server/src/modules/project-updates/projectUpdatesService.ts`**

```ts
import type { QueryResult } from '../../db/connection.js';
import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import type { ProjectUpdateEntry, ProjectUpdateHistory } from '@tracker/shared';

export class ProjectUpdatesError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectUpdatesError';
  }
}

interface ProjectUpdateRow extends QueryResult {
  id: string;
  project_id: string;
  staff_id: string;
  staff_name: string;
  changes_json: string;
  update_progress: string;
  is_read: boolean;
  created_at: string;
}

function toEntry(row: ProjectUpdateRow): ProjectUpdateEntry {
  let changes: Record<string, { old: unknown; new: unknown }> = {};
  try { changes = JSON.parse(row.changes_json); } catch { /* leave empty */ }
  return {
    id: row.id,
    project_id: row.project_id,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    changes,
    update_progress: row.update_progress,
    is_read: row.is_read,
    created_at: row.created_at,
  };
}

/**
 * Insert one history row inside an already-open write transaction (pass the
 * `ex` executor from the caller's runWrite block — this must never open its
 * own mutex, or it will deadlock against the caller's).
 */
export async function recordProjectUpdate(
  ex: (sql: string, params?: unknown[]) => Promise<QueryResult[]>,
  input: {
    projectId: string;
    staffId: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    updateProgress: string;
  },
): Promise<void> {
  await ex(
    `INSERT INTO project_updates (id, project_id, staff_id, changes_json, update_progress, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, false, current_timestamp)`,
    [uuid(), input.projectId, input.staffId, JSON.stringify(input.changes), input.updateProgress],
  );
}

/**
 * SUPER_ADMIN-only. Fetches full history newest-first AND marks every entry
 * for this project as read, atomically, so opening the modal is what clears
 * the grid's yellow dot.
 */
export async function getHistoryAndMarkRead(projectId: string): Promise<ProjectUpdateHistory> {
  const projectRows = await runRead<{ id: string; project_name: string }>(
    `SELECT id, project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const project = projectRows[0];
  if (!project) throw new ProjectUpdatesError('Project not found', 404);

  return runWrite(async (ex) => {
    const rows = (await ex(
      `SELECT pu.*, u.name AS staff_name
       FROM project_updates pu JOIN users u ON u.id = pu.staff_id
       WHERE pu.project_id = ?
       ORDER BY pu.created_at DESC`,
      [projectId],
    )) as ProjectUpdateRow[];

    await ex(`UPDATE project_updates SET is_read = true WHERE project_id = ?`, [projectId]);

    return {
      project_id: project.id,
      project_name: project.project_name,
      entries: rows.map(toEntry),
    };
  });
}

/**
 * Batch lookup used by the grid list query: latest update_progress + whether
 * any unread entry exists, per project id. Only queries the ids on the
 * current page — cheap at this app's scale.
 */
export async function getLatestUpdateInfo(
  projectIds: string[],
): Promise<Map<string, { update_progress: string; has_unread_update: boolean }>> {
  const result = new Map<string, { update_progress: string; has_unread_update: boolean }>();
  if (projectIds.length === 0) return result;

  const placeholders = projectIds.map(() => '?').join(', ');
  const rows = await runRead<{ project_id: string; update_progress: string; is_read: boolean; created_at: string }>(
    `SELECT project_id, update_progress, is_read, created_at
     FROM project_updates
     WHERE project_id IN (${placeholders})
     ORDER BY created_at DESC`,
    projectIds,
  );

  for (const row of rows) {
    const existing = result.get(row.project_id);
    if (!existing) {
      result.set(row.project_id, { update_progress: row.update_progress, has_unread_update: !row.is_read });
    } else if (!row.is_read) {
      existing.has_unread_update = true; // any unread entry flips it, not just the latest
    }
  }
  return result;
}
```

**New file: `apps/server/src/modules/project-updates/routes.ts`**

```ts
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getHistoryAndMarkRead, ProjectUpdatesError } from './projectUpdatesService.js';

const idParam = z.object({ id: z.string().uuid() });

export const projectUpdatesRouter = Router();
projectUpdatesRouter.use(requireAuth);

// SUPER_ADMIN only, per spec — this is also what clears the grid's yellow dot.
projectUpdatesRouter.get('/:id/updates', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    res.json(await getHistoryAndMarkRead(id));
  } catch (err) {
    if (err instanceof ProjectUpdatesError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: err.flatten() });
      return;
    }
    console.error('Project updates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**File: `apps/server/src/app.ts`** — remove `pendingEditsRouter` import/mount. Mount the new router
under the same `/api/projects` prefix so the path in the router above (`/:id/updates`) resolves to
`/api/projects/:id/updates`:

```ts
app.use('/api/projects', projectsRouter);
app.use('/api/projects', projectUpdatesRouter);
```

(Express allows two routers on the same prefix; order doesn't matter here since the path suffixes
don't collide with `projectsRouter`'s own routes.)

**File: `apps/server/src/modules/projects/projectsService.ts`** — wire `getLatestUpdateInfo` into
`listProjects`'s `enrich()`:

```ts
const updateInfo = await getLatestUpdateInfo(rows.map((r) => r.id));
const enrich = (rows: ProjectRow[]) =>
  rows.map((r) => {
    const info = updateInfo.get(r.id);
    return {
      ...r,
      priority: computePriority(computeAging(r), thresholds),
      update_progress: info?.update_progress ?? null,
      has_unread_update: info?.has_unread_update ?? false,
    };
  });
```

Note `updateInfo` must be computed from the **already-paginated** `rows`/`all` slice (after the
`.slice(offset, offset + pageSize)` for the derived-sort branch, or after the `LIMIT/OFFSET` fetch
for the SQL-sort branch) — call it right before each branch's `enrich(rows)`/`enrich(all...)` call,
not once globally, since the two branches produce their page-sized row set at different points.

**Gate:** `npm run typecheck -w @tracker/server`.

---

## Phase 5 — Server cleanup: seed script + notifications

**File: `apps/server/src/seed-dummy.ts`** — the `PENDING_EDIT_SPECS` block inserts into
`pending_edits`, which no longer exists. Replace it with a small number of `project_updates` demo
rows instead, so the grid has something to show in the new column and the history modal isn't
empty during manual testing:

```ts
const UPDATE_PROGRESS_SPECS: Array<{ projectName: string; changes: Record<string, unknown>; note: string }> = [
  { projectName: `${NAME_PREFIX} 004`, changes: { customer_price: 875_000_000 }, note: 'Customer confirmed new PO amount over the phone.' },
  { projectName: `${NAME_PREFIX} 010`, changes: { issues: 'Vendor requested revised pricing; awaiting internal approval.' }, note: 'Flagging vendor pricing issue for visibility.' },
];
```

For each spec: read the project's current values for the changed fields (so `changes_json` has
real `old` values), apply the `UPDATE`, insert the `project_updates` row via
`recordProjectUpdate`, attributed to the STAFF `requester` already resolved in the file. Keep the
existing idempotency guard pattern (skip if a `project_updates` row already exists referencing that
project).

**File: `apps/server/src/modules/pending-edits/pendingEditsService.ts`'s `notifyNewApproval` calls**
— these are gone along with the file. Nothing else references `NEW_APPROVAL`; leave
`notificationsService.ts` and the `notifications` table as-is (dormant type, no migration needed).

**Gate:** `npm run typecheck -w @tracker/server`, then `npm run seed:dummy -w @tracker/server`
against a fresh dev DB and confirm it completes without error.

---

## Phase 6 — Frontend: remove approval UI

**Delete:**
- `apps/web/src/app/approvals/ApprovalsPage.tsx`
- `apps/web/src/components/approvals/ApprovalQueueList.tsx`
- `apps/web/src/components/approvals/DiffView.tsx` (its diff-table rendering approach is reused
  conceptually in Phase 10's new component, but not the file itself — the data shape is different)
- `apps/web/src/hooks/usePendingEdits.ts`

**File: `apps/web/src/App.tsx`** — remove the `/approvals` `<Route>` and the `ApprovalsPage` import.

**File: `apps/web/src/components/AppLayout.tsx`** — remove the "Approvals" `<NavLink>` and the
`canSeeApprovals(user?.role) && (...)` block wrapping it. **Careful:** the "Drive Browser" nav link
also currently gates on `canSeeApprovals(...)` (a pre-existing naming mismatch) — switch that one to
`canManageDriveFolder(user?.role)`, which already exists in `apps/web/src/lib/rbac.ts` and means the
same thing (SUPER_ADMIN-only), so Drive Browser visibility doesn't regress.

**File: `apps/web/src/lib/rbac.ts`** — remove `canSeeApprovals` once nothing imports it.

**File: `apps/web/src/app/grid/GridPage.tsx`** — `handleRowUpdate` and `handleAddProject` currently
branch on `res.submitted`. Since neither endpoint returns that anymore, simplify both to the
non-pending success path only. Also drop the `pendingProjectIds` computation (from
`usePendingEdits`/`useMyPendingEdits`, both gone) and stop passing `pendingProjectIds` into
`<ProjectTable>` — the grid no longer needs a "pending" badge concept at all (superseded by the
Update Progress column's own unread indicator).

**Gate:** `npm run typecheck -w @tracker/web`. The app should build; `/approvals` now 404s via the
catch-all redirect to `/grid`.

---

## Phase 7 — Frontend: STAFF loses inline editing, gets row-click-to-modal

**File: `apps/web/src/components/data-grid/ProjectTable.tsx`**

Change the per-cell `editable` computation so STAFF never gets the inline pencil-free editable
button, regardless of `meta.editable`:

```ts
// was: const editable = !!meta?.editable && !(meta?.adminOnly && !isAdmin);
const editable = isAdmin && !!meta?.editable;
```

Since `adminOnly` fields (Sales) were already only editable when `isAdmin` was true, this is a
strict simplification — no behavior change for admin.

Add row-click-to-modal for STAFF. On the row `<div role="row">`, add:

```tsx
onClick={!isAdmin ? () => setEditModalRow(row.original) : undefined}
```

and give it a pointer cursor when `!isAdmin`. Every interactive element **inside** the row must
stop propagation so it doesn't also pop the modal open:
- The upload button/input in `UploadedDocCell` (`apps/web/src/components/data-grid/columns.tsx`) —
  wrap its existing `onClick`/file-input `<label>`/button handlers with `e.stopPropagation()`.
- The Drive folder link `<a>` in `driveLinkColumn` — add `onClick={(e) => e.stopPropagation()}` (the
  anchor's default navigation still fires; only the bubble-up to the row is stopped).
- The existing pencil button on the project-name cell already calls `e.stopPropagation()` — leave
  it; it's now a secondary, equivalent way for STAFF to open the same modal, and remains the primary
  way for SUPER_ADMIN (whose rows are not click-to-open).

**Gate:** `npm run typecheck -w @tracker/web`. Manual check: log in as STAFF, confirm no cell shows
the hover-editable outline anymore and clicking anywhere on a row (except the Drive link/upload
icon) opens the edit modal.

---

## Phase 8 — Frontend: mandatory Update Progress in the STAFF modal

**File: `apps/web/src/components/data-grid/EditProjectModal.tsx`**

Add local state:

```ts
const [updateProgress, setUpdateProgress] = useState('');
```

Add a new fieldset, rendered only for STAFF, placed after the existing field sections and before
the error/footer block in `renderBody()`:

```tsx
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
```

Update `handleSave`:

```ts
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
```

Also disable the Save button when STAFF and the textarea is empty, for immediate feedback rather
than only on click:

```tsx
disabled={saving || !draft.project_name?.trim() || (!isAdmin && !updateProgress.trim())}
```

`onSave`'s type signature (`(row, changes) => Promise<EditResult>`) doesn't need to change —
`update_progress` just rides along inside `changes`, and the route/service layer (Phase 3) knows to
peel it back off the request body before Zod-validating the rest as `projectUpdateSchema`.

**Note:** since STAFF writes are no longer "pending," `res.pending` will never be true from here on;
Phase 6 already simplified the toast wording in `GridPage.tsx`, so `onNotice?.('Saved.', ...)` above
is consistent with that (drop the old `res.pending ? 'Change submitted for approval.' : 'Saved.'`
ternary this file used to have too).

**Gate:** `npm run typecheck -w @tracker/web`.

---

## Phase 9 — Frontend: "Update Progress" grid column + unread dot

**File: `apps/web/src/components/data-grid/columns.tsx`**

Add a new column definition, appended as its own trailing group (or the last entry in the `vendor`
group — either is fine; a dedicated group makes the yellow-dot affordance visually distinct):

```tsx
function UpdateProgressCell({ row, isAdmin, onOpenHistory }: {
  row: Project;
  isAdmin: boolean;
  onOpenHistory: (project: Project) => void;
}) {
  const text = row.update_progress;
  const unread = !!row.has_unread_update;
  const content = text ? (
    <span className="block truncate text-sm text-gray-800" title={text}>{text}</span>
  ) : (
    <span className="text-gray-300">—</span>
  );

  if (!isAdmin) return content; // STAFF sees the text but can't open the history modal

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenHistory(row); }}
      className="flex w-full items-center gap-1.5 text-left hover:underline"
      title="View update history"
    >
      {unread && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="Unread update" data-testid="unread-update-dot" />
      )}
      {content}
    </button>
  );
}
```

`projectColumns` is currently a static array built without access to component callbacks, so
`updateProgressColumn` needs to be a **function** (like `salesColumn()`/`picColumn()`) taking the
callback, e.g. `updateProgressColumn(onOpenHistory, isAdmin)`, returned as a `ColumnDef<Project>`
with `accessorKey: 'update_progress'`, `header: 'Update Progress'`, `size: 220`, `cell: ({ row }) =>
<UpdateProgressCell row={row.original} isAdmin={isAdmin} onOpenHistory={onOpenHistory} />`. This
means `projectColumns` can no longer be a top-level constant — convert it to a function
`buildProjectColumns({ isAdmin, onOpenHistory }): ColumnDef<Project>[]` and update
`ProjectTable.tsx`'s `useReactTable({ columns: ... })` call to call it (memoize with `useMemo`
keyed on `[isAdmin, onOpenHistory]`). No `meta.editable` on this column, so it's never inline-
editable for either role, consistent with `priority`/`aging`.

**File: `apps/web/src/components/data-grid/ProjectTable.tsx`**

Add:

```ts
const [historyRow, setHistoryRow] = useState<Project | null>(null);
```

Pass `onOpenHistory={setHistoryRow}` into the memoized `buildProjectColumns` call. Render
`<UpdateHistoryModal project={historyRow} onClose={() => setHistoryRow(null)} />` alongside the
existing `EditProjectModal` render at the bottom of the component (only when `historyRow` is set).
Opening it should also invalidate the projects query so the yellow dot clears in the grid without a
full page reload — do this inside the new `useProjectUpdateHistory` hook (Phase 10) via
`queryClient.invalidateQueries({ queryKey: ['projects'] })` `onSuccess`.

**Gate:** `npm run typecheck -w @tracker/web`.

---

## Phase 10 — Frontend: history hook + `UpdateHistoryModal`

**New file: `apps/web/src/hooks/useProjectUpdates.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ProjectUpdateHistory } from '@tracker/shared';

export function useProjectUpdateHistory(projectId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['project-updates', projectId],
    queryFn: async () => {
      const data = await apiClient.get<ProjectUpdateHistory>(`/api/projects/${projectId}/updates`);
      // Fetching marks the entries read server-side — reflect that in the grid immediately.
      qc.invalidateQueries({ queryKey: ['projects'] });
      return data;
    },
    enabled: !!projectId,
    staleTime: 0,
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error };
}
```

**New file: `apps/web/src/components/data-grid/UpdateHistoryModal.tsx`**

Structure per the spec: project name header; newest-first list; each entry shows STAFF name +
timestamp, an old→new diff table on the main side, update-progress text on the side.

```tsx
import { useProjectUpdateHistory } from '../../hooks/useProjectUpdates';
import { FIELD_LABELS } from '../../lib/projectFields';
import type { Project, ProjectUpdateEntry } from '@tracker/shared';

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function HistoryEntryCard({ entry }: { entry: ProjectUpdateEntry }) {
  const fields = Object.keys(entry.changes);
  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-800">{entry.staff_name}</span>
        <span className="text-xs text-gray-400">{fmtDate(entry.created_at)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <table className="w-full border-collapse text-sm md:col-span-2">
          <tbody>
            {fields.map((key) => (
              <tr key={key} className="border-b border-gray-100 align-top">
                <td className="w-2/5 py-1 pr-2 text-gray-500">{FIELD_LABELS[key] ?? key}</td>
                <td className="w-1/4 py-1 pr-2 text-gray-400 line-through">{fmt(entry.changes[key].old)}</td>
                <td className="py-1 font-medium text-green-700">→ {fmt(entry.changes[key].new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rounded bg-amber-50 p-2 text-sm text-gray-700 md:col-span-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Update Progress</p>
          {entry.update_progress}
        </div>
      </div>
    </div>
  );
}

export function UpdateHistoryModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { data, isLoading, isError } = useProjectUpdateHistory(project?.id ?? null);
  if (!project) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Update history — ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-800">{project.project_name} — Update History</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {isLoading && <p className="text-sm text-gray-500">Loading history…</p>}
          {isError && <p className="text-sm text-red-600">Could not load update history.</p>}
          {!isLoading && !isError && (data?.entries.length ?? 0) === 0 && (
            <p className="text-sm text-gray-400">No updates recorded for this project yet.</p>
          )}
          {data?.entries.map((entry) => <HistoryEntryCard key={entry.id} entry={entry} />)}
        </div>
      </div>
    </div>
  );
}
```

**Gate:** `npm run typecheck -w @tracker/web`.

---

## Phase 11 — Tests

**Delete or rewrite** (they exercise the approval flow directly):
- `apps/web/e2e/edit-modal.spec.ts` — the `'staff editing via the modal is held for approval...'`
  and `'staff cannot reassign the Sales owner...'` tests need rewriting: STAFF save should now
  require filling Update Progress, apply immediately, and the grid should reflect the new value
  right away (no more "value stays old until approved" assertion).
- `apps/web/e2e/notifications.spec.ts` — the `'staff edit generates a notification for the admin'`
  test relied on `NEW_APPROVAL`; either delete it or repoint it at the new unread-dot behavior
  (assert `data-testid="unread-update-dot"` appears after a STAFF edit, then disappears after the
  admin opens the history modal).
- `apps/web/e2e/grid.spec.ts` — `'staff sees a read-only Sales cell with no dropdown affordance'`
  and `'admin can change the assigned Sales for an existing project inline'` still hold, but any
  test that clicked an inline editable cell **as STAFF** needs to move to modal-based interaction.

**New: `apps/web/e2e/update-progress.spec.ts`** — cover:
1. STAFF opens a row modal, changes a field, tries to save with empty Update Progress → blocked
   (Save disabled or error shown).
2. STAFF fills Update Progress, saves → grid shows the new value immediately (no pending state),
   the "Update Progress" column shows the note text and a yellow dot.
3. Admin logs in, sees the yellow dot on that row, clicks the Update Progress cell → history modal
   shows project name, STAFF name, old→new diff, the note, newest first.
4. Dot disappears after closing the modal (grid refetches / cache invalidated).

**Gate:** run the full Playwright suite (`npx playwright test`) against a freshly seeded DB
(`npm run seed -w @tracker/server && npm run seed:dummy -w @tracker/server` or your usual fixture
setup) before calling this done.

---

## Phase 12 — Final sweep

- `npm run typecheck --workspaces` clean.
- `npm run build --workspaces` clean.
- Grep the repo for `pending_edits`, `PendingEdit`, `submitCreate`, `submitUpdate`,
  `NEW_APPROVAL`, `usePendingEdits`, `canSeeApprovals` to confirm nothing dangling remains
  (aside from the intentionally-dormant `NEW_APPROVAL` CHECK-constraint value noted in Decisions).
- Manual pass: STAFF login → row click → modal → required Update Progress → save → row updates
  live, no approval step anywhere in the UI. Admin login → grid shows Update Progress column,
  clicks an unread one → history modal, dot clears.
