# Planning: PIC / Issues / Aging Columns + In-App Notifications

## 1. Scope

Two workstreams, sequenced so the first unblocks the second:

1. **Three new project fields**: `PIC`, `Issues`, `Aging`
2. **In-app notification system** replacing the (deferred) Gmail digest — surfaces aging alerts and new pending-approval events inside the app itself

Gmail digest work stays out of scope for now — `googleapis` dependency and `.env` digest vars already exist but nothing calls them yet, so there's nothing to unwind.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Aging sortability | Unsortable for v1 (`enableSorting: false`) |
| Aging alert recipients | SUPER_ADMIN only |
| Aging threshold | Hardcoded constant `AGING_ALERT_DAYS` in `thresholds.ts`; configurable settings deferred to follow-up |
| Aging on finished projects | Skip — cron filters `WHERE current_stage = 'on_progress'` |
| Migration parquet refresh | Re-export parquet after ALTER TABLE ADD COLUMN |
| Bell dropdown UX | Show all notifications (read + unread), unread highlighted, "Mark all as read" button in header |
| Notification retention | Keep indefinitely |
| Issues field length | No character limit |

---

## 3. New columns

### 3.1 `PIC` (Person In Charge)
- Plain string, free text (no lookup against `users` — matches how `vendor_name`/`customer_name` work today).
- Editable by the same rules as other project fields (SUPER_ADMIN direct write, STAFF via pending edit).
- Column factory: reuse the existing `text()` helper — no new factory needed.

### 3.2 `Issues`
- Free-text notes field. Long content expected, so extend `EditableCell` with a `<textarea>` mode rather than reusing the single-line `<input>`.
- Same edit/approval permissions as everything else.

### 3.3 `Aging`
- **Not a stored column** — computed, like `status_flag` already is (`computeProjectFlag` in `apps/web/src/lib/projectStatus.ts`).
- Spreadsheet formula being ported:
  ```
  =IF(Q5="", "", IF(U5="", NETWORKDAYS(Q5, TODAY())-1, NETWORKDAYS(Q5, U5)-1))
  ```
  Q5 → `project_sent_date`, U5 → `approval_date`.
- Business-day (`NETWORKDAYS`) logic doesn't exist anywhere in the codebase yet — needs a small utility:
  - Input: start date, end date (or "today" if end is null)
  - Output: count of weekdays between the two dates, minus 1, or blank if start date is null
  - No holiday calendar in the spreadsheet formula either, so skip holiday-awareness for parity (to be added later on)
- **Where it lives**: `packages/shared/src/lib/aging.ts` (new file), exported from `packages/shared/src/index.ts` — both the notification cron job (server-side) and the grid (client-side) use the exact same calculation.
- Rendered as a non-editable column, unsortable for v1.

---

## 4. Implementation steps

### Step 1: DB schema + migration logic

**File: `apps/server/src/db/migrate.ts`**

- Add `pic VARCHAR` and `issues VARCHAR` to the `projects` DDL string (aging is not persisted).
- Add new `notifications` table DDL:
  ```sql
  CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR PRIMARY KEY,
    recipient_id VARCHAR NOT NULL REFERENCES users(id),
    type VARCHAR NOT NULL CHECK (type IN ('NEW_APPROVAL','AGING_ALERT')),
    project_id VARCHAR REFERENCES projects(id),
    pending_edit_id VARCHAR REFERENCES pending_edits(id),
    message VARCHAR NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
  );
  ```
- `recipient_id` scopes rows per-user (simplest RBAC — reuse `requireAuth`, filter `WHERE recipient_id = ?`).
- `project_id` / `pending_edit_id` let the frontend deep-link ("go to project" / "go to approval queue").
- **Post-DDL migration for existing databases**: `CREATE TABLE IF NOT EXISTS` won't alter an existing `projects` table. After running the DDL string, query `duckdb_columns()` to check if `pic`/`issues` exist on `projects`. If missing, run `ALTER TABLE projects ADD COLUMN pic VARCHAR` / `ALTER TABLE projects ADD COLUMN issues VARCHAR`, then call `exportSnapshots(['projects'])` to refresh parquet with the new schema.

### Step 2: Shared package — schemas + aging utility

**File: `packages/shared/src/schemas/project.ts`**
- Add `pic: z.string().optional().nullable()` and `issues: z.string().optional().nullable()` to `projectSchema`.
- Add to `projectCreateSchema` and `projectUpdateSchema` (optional for both).

**File: `packages/shared/src/thresholds.ts`**
- Add `export const AGING_ALERT_DAYS = 30;`

**New file: `packages/shared/src/lib/aging.ts`**
- `networkDays(startDate: Date, endDate: Date): number` — counts weekdays between two dates, minus 1.
- `computeAging(project: { project_sent_date: string | null; approval_date: string | null }): number | null` — returns null if `project_sent_date` is null, otherwise uses `networkDays` with `approval_date ?? new Date()`.

**File: `packages/shared/src/index.ts`**
- Export `aging.ts` utilities and `AGING_ALERT_DAYS`.

### Step 3: Backend — pending edits service

**File: `apps/server/src/modules/pending-edits/pendingEditsService.ts`**

- Add `'pic'` and `'issues'` to the `PROJECT_COLUMNS` array (used by `insertProjectSql`/`buildInsertValues`).
- Wire `NEW_APPROVAL` notification generation into `submitCreate` and `submitUpdate`, inside the same `runWrite` block:
  - After inserting the `pending_edits` row, query all active SUPER_ADMINs (`SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = true`).
  - Insert one `notifications` row per admin: `{ recipient_id, type: 'NEW_APPROVAL', project_id: (null for CREATE), pending_edit_id: newEditId, message: "New approval request: {project_name}" }`.

### Step 4: Backend — notifications module

**New directory: `apps/server/src/modules/notifications/`**

**File: `notificationsService.ts`**
- `listNotifications(userId, limit?)` — `SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT ?` (default 50).
- `getUnreadCount(userId)` — `SELECT COUNT(*) FROM notifications WHERE recipient_id = ? AND is_read = false`.
- `markAsRead(notificationId, userId)` — `UPDATE notifications SET is_read = true WHERE id = ? AND recipient_id = ?` (enforce ownership).
- `markAllAsRead(userId)` — `UPDATE notifications SET is_read = true WHERE recipient_id = ? AND is_read = false`.

**File: `routes.ts`**
- `GET /api/notifications` — requireAuth, calls `listNotifications`.
- `GET /api/notifications/unread-count` — requireAuth, calls `getUnreadCount`.
- `POST /api/notifications/:id/read` — requireAuth, calls `markAsRead`.
- `POST /api/notifications/read-all` — requireAuth, calls `markAllAsRead`.

**File: `apps/server/src/app.ts`**
- Mount: `app.use('/api/notifications', notificationsRouter)`.

### Step 5: Backend — aging cron job

**New file: `apps/server/src/jobs/agingCron.ts`**
- Import `computeAging` and `AGING_ALERT_DAYS` from `@tracker/shared`.
- Export a `startAgingCron(db)` function that uses `node-cron` to schedule a daily job (e.g. `'0 7 * * *'` — 7am).
- Job logic:
  1. Query all `on_progress` projects: `SELECT id, project_name, project_sent_date, approval_date, staff_assigned_id FROM projects WHERE current_stage = 'on_progress'`.
  2. For each, compute `aging = computeAging(project)`.
  3. If `aging >= AGING_ALERT_DAYS`, check if an unread `AGING_ALERT` notification already exists for that project (to avoid duplicate spam on every run).
  4. If not, insert notification for all active SUPER_ADMINs.
  5. Wrap in try/catch — log errors, never crash the process.

**File: `apps/server/src/server.ts`**
- After `await migrate()` and Google init, call `startAgingCron(db)` (import from `./jobs/agingCron`).
- Guard with try/catch so a cron scheduling failure doesn't prevent boot.

### Step 6: Frontend — new columns in grid

**File: `apps/web/src/components/data-grid/columns.tsx`**
- Add `text('pic', 'PIC', { ... })` column in the Project Info group.
- Add `issues` column — create a small `textareaCol` factory or extend the existing pattern.
- Add `agingColumn` — computed column using `id: 'aging'`, `accessorFn: (row) => computeAging(row.original)`, non-editable, `enableSorting: false`.

**File: `apps/web/src/components/data-grid/ProjectTable.tsx`**
- Extend `EditableCell` to support a `<textarea>` mode for the `issues` field. When `column.id === 'issues'`, render `<textarea>` in edit mode instead of `<input>`. Save on blur or Ctrl+Enter.

**File: `apps/web/src/app/grid/GridPage.tsx`**
- Add `pic` (text input) and `issues` (textarea input) to the "Add project" / "Propose new project" form.

**File: `apps/web/src/components/approvals/DiffView.tsx`**
- Add `pic: 'PIC'` and `issues: 'Issues'` to `FIELD_LABELS`.
- Add to appropriate section in `SECTION_OF` map.

### Step 7: Frontend — notification bell

**New file: `apps/web/src/hooks/useNotifications.ts`**
- TanStack Query hook for `GET /api/notifications` (list) with `refetchInterval: 30_000`.
- TanStack Query hook for `GET /api/notifications/unread-count` with `refetchInterval: 15_000`.
- Mutation: `markAsRead(id)` → `POST /api/notifications/:id/read`, invalidates queries.
- Mutation: `markAllAsRead()` → `POST /api/notifications/read-all`, invalidates queries.

**New file: `apps/web/src/components/NotificationBell.tsx`**
- Bell icon (lucide-react `Bell`) with badge showing unread count.
- Dropdown/popover panel:
  - Header: "Notifications" + "Mark all as read" button.
  - List: recent notifications (last 50), unread ones visually highlighted.
  - Each item: message text, timestamp, click → navigate to `/grid` or `/approvals` based on notification type + mark as read.
  - Empty state: "No notifications".

**File: `apps/web/src/components/AppLayout.tsx`**
- Import and render `NotificationBell` in the header/nav area, visible to all authenticated users.

### Step 8: E2E tests

**File: `apps/web/e2e/grid.spec.ts`** (extend)
- Test: admin can see PIC, Issues, Aging columns in the grid.
- Test: admin can edit PIC and Issues cells inline.
- Test: Aging column shows computed value for projects with `project_sent_date`.

**New file: `apps/web/e2e/notifications.spec.ts`** (or extend grid.spec.ts)
- Test: when a STAFF submits a pending edit, SUPER_ADMIN sees a notification in the bell.
- Test: clicking a notification navigates to the correct page and marks it read.
- Test: "Mark all as read" clears the unread count.

---

## 5. File change summary

| File | Action |
|---|---|
| `apps/server/src/db/migrate.ts` | Edit: add columns, notifications table, ALTER TABLE migration logic |
| `packages/shared/src/schemas/project.ts` | Edit: add `pic`, `issues` fields |
| `packages/shared/src/thresholds.ts` | Edit: add `AGING_ALERT_DAYS` |
| `packages/shared/src/lib/aging.ts` | **New**: `networkDays()`, `computeAging()` |
| `packages/shared/src/index.ts` | Edit: export new utilities |
| `apps/server/src/modules/pending-edits/pendingEditsService.ts` | Edit: add to PROJECT_COLUMNS, wire NEW_APPROVAL notifications |
| `apps/server/src/modules/notifications/notificationsService.ts` | **New** |
| `apps/server/src/modules/notifications/routes.ts` | **New** |
| `apps/server/src/app.ts` | Edit: mount notifications router |
| `apps/server/src/jobs/agingCron.ts` | **New** |
| `apps/server/src/server.ts` | Edit: start aging cron |
| `apps/web/src/components/data-grid/columns.tsx` | Edit: add PIC, Issues, Aging columns |
| `apps/web/src/components/data-grid/ProjectTable.tsx` | Edit: textarea mode in EditableCell |
| `apps/web/src/app/grid/GridPage.tsx` | Edit: add PIC/Issues to form |
| `apps/web/src/components/approvals/DiffView.tsx` | Edit: add labels for PIC/Issues |
| `apps/web/src/hooks/useNotifications.ts` | **New** |
| `apps/web/src/components/NotificationBell.tsx` | **New** |
| `apps/web/src/components/AppLayout.tsx` | Edit: add bell to header |
| `apps/web/e2e/grid.spec.ts` | Edit: extend tests |
| `apps/web/e2e/notifications.spec.ts` | **New** (optional) |
