# Technical Specification & Implementation Plan
## AppSheet-Style Administrative Project Tracking Web App

**Version:** 2.0
**Author:** Senior Software Architect (Claude) + implementation tracking
**Deployment context:** Small team, LAN, 2–10 concurrent users, 10–50 staff accounts, 50–500 projects
**Google integration:** Single shared service account

> **Status:** v2.0 reflects the *implemented* state of the codebase (Phases 0–5,
> Phase 6A Google Drive, plus post-plan extensions: PIC/Issues/Aging,
> Aging→Priority thresholds, in-app notifications, per-user Dashboard, row-edit
> modal, and the Playwright E2E suite). Phase 6B (Gmail digest) and the
> remaining Phase 7 hardening items are still open — see §10.1 and §11.
> Sections that describe the *original plan* but have since been superseded
> (e.g. the Gmail digest as the alerting channel) are called out inline.

---

## 1. Architecture Overview

### 1.1 High-Level Diagram (textual)

```
┌─────────────────────┐        HTTPS/HTTP (LAN)       ┌──────────────────────────┐
│  React + Vite SPA    │ <────────────────────────────> │  Express API Server       │
│  (Staff/Admin browser)│         REST + JWT             │  Node.js, single process  │
└─────────────────────┘                                 │                            │
                                                          │  ┌──────────────────────┐ │
                                                          │  │ Write Queue (mutex)   │ │
                                                          │  └──────────┬───────────┘ │
                                                          │             ▼             │
                                                          │  ┌──────────────────────┐ │
                                                          │  │ DuckDB Native Store   │ │
                                                          │  │ app.duckdb (WAL)      │ │
                                                          │  └──────────┬───────────┘ │
                                                          │             ▼ export      │
                                                          │  ┌──────────────────────┐ │
                                                          │  │ Parquet Snapshots     │ │
                                                          │  │ projects.parquet      │ │
                                                          │  │ users.parquet         │ │
                                                          │  │ pending_edits.parquet │ │
                                                          │  └──────────────────────┘ │
                                                          │                            │
                                                          │  ┌──────────────────────┐ │
                                                          │  │ Cron Worker (06:00)   │ │
                                                          │  │ → Gmail digest        │ │
                                                          │  └──────────────────────┘ │
                                                          └──────────────┬─────────────┘
                                                                         ▼
                                                          ┌──────────────────────────┐
                                                          │ Google Drive API          │
                                                          │ Gmail API                 │
                                                          │ (shared service account)  │
                                                          └──────────────────────────┘
```

### 1.2 Key Architectural Decisions (and why)

| Decision | Rationale |
|---|---|
| **CONFIRMED: DuckDB native `.duckdb` file is the transactional source of truth; Parquet files are generated snapshots** | Real `UPDATE`/`INSERT`/`DELETE` with row-level integrity and WAL crash-safety. Raw Parquet has no update semantics — every "edit" would otherwise mean rewriting the entire table file, which is unsafe under concurrent access. **Both the `.duckdb` file and the `.parquet` snapshots remain entirely local, on-disk on the same machine running the Express server — this decision does not introduce any network/cloud dependency or move storage off the local machine.** |
| **Single shared DuckDB connection + in-process async write mutex** | DuckDB's Node bindings are safest with one writer at a time. At this scale (500 rows), serializing all writes costs single-digit milliseconds — no need for connection pooling complexity. Reads can share the same connection since queries are fast and infrequent. |
| **Parquet export triggered synchronously after every committed write** | Keeps the "official" Parquet artifacts always consistent with the DB, so they remain valid as a portable backup/interchange format (e.g., for BI tools, ad-hoc DuckDB CLI queries, or migration). |
| **Staff edits never touch `projects` table directly — always via `pending_edits`** | Enforces the approval workflow at the data layer, not just the UI layer, so it can't be bypassed by a direct API call. |
| **JWT with short-lived access token + server-side session table for revocation** | LAN deployment doesn't need OAuth-grade infrastructure, but you still want the ability to kill a session (e.g., staff offboarding) without waiting for token expiry. |
| **Google service account for Drive; domain-wide delegation required for Gmail send** | A bare service account cannot send email "as" a Workspace user without domain-wide delegation enabled by a Workspace admin. This is called out explicitly in section 7 — it's an easy step to miss and the digest feature silently fails without it. |
| **Backend serves the built SPA (single deployable)** | For a 2–10 user LAN app, running two separate dev servers in production adds ops overhead for no benefit. Express serves the Vite production build as static files behind the same port as the API. |

### 1.3 Assumptions Made (flag if incorrect)

- **Storage engine (confirmed, no longer open):** the DuckDB native `.duckdb` file is the primary local data store; Parquet files are generated local snapshots. Both live on local disk on the server machine — nothing about this is remote/cloud/networked.
- The organization uses **Google Workspace** (not consumer Gmail), since domain-wide delegation requires Workspace admin console access.
- "Local network" means the Express server runs on one machine (e.g., an office PC or small server) and staff connect via its LAN IP or a local hostname — no public internet exposure, so HTTPS is recommended but not strictly mandated (see Security, §9).
- File attachments/documents themselves live in Google Drive, not in the app — the app only stores links/IDs.
- "Mock session switcher" (dev step 2) is a **development-only** convenience to test both roles without two logins, and must be disabled/removed in production builds.

If any of these are wrong, flag it before implementation starts — they affect auth design and the Gmail integration setup steps.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling/UI | Tailwind CSS + hand-rolled components (no shadcn/ui package — see §6.1) |
| Data grid | TanStack Table v8 (headless) + TanStack Virtual (row virtualization for 500-row grids) |
| Charts | `recharts` (pie/bar for the per-user Dashboard views) |
| Data fetching/cache | TanStack Query |
| Forms/validation | React Hook Form + Zod |
| Backend | Node.js + Express (TypeScript) |
| DB engine | DuckDB (`duckdb` npm package) — native `.duckdb` file as source of truth, Parquet as export snapshot |
| Auth | JWT (access + refresh) via `jsonwebtoken`, password hashing via `argon2` |
| Scheduler | `node-cron` |
| Google APIs | `googleapis` npm package, service account JSON key |
| Validation shared types | Zod schemas shared between client/server via a `packages/shared` workspace |

**Monorepo layout:** npm/pnpm workspaces with `apps/web`, `apps/server`, `packages/shared`.

---

## 3. Data Schema

### 3.1 DuckDB DDL (source of truth — `app.duckdb`)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid(),
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL UNIQUE,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL CHECK (role IN ('SUPER_ADMIN','STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE market_segments (        -- backs the "dynamic dropdown" settings feature
  id UUID PRIMARY KEY DEFAULT uuid(),
  label VARCHAR NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid(),
  folder_name VARCHAR,
  project_name VARCHAR NOT NULL,
  staff_assigned_id UUID REFERENCES users(id),
  drive_folder_id VARCHAR,            -- Google Drive folder ID for deep-link resolution

  -- Customer section
  customer_name VARCHAR,
  market_segment VARCHAR,
  service_or_goods VARCHAR CHECK (service_or_goods IN ('service','goods')),
  date_customer_received_doc1 DATE,
  date_customer_received_doc2 DATE,
  doc2_number_id VARCHAR,
  customer_price INTEGER,
  customer_start_contract DATE,
  customer_end_contract DATE,

  -- Vendor section
  vendor_name VARCHAR,
  vendor_revenue INTEGER,
  vendor_type VARCHAR CHECK (vendor_type IN ('service','goods')),
  project_sent_date DATE,
  project_finish_date DATE,
  vendor_project_id VARCHAR,
  negotiation_date DATE,
  approval_date DATE,
  document_sent_date DATE,
  document_id VARCHAR,
  vendor_price INTEGER,
  vendor_start_contract DATE,
  vendor_end_contract DATE,
  current_stage VARCHAR CHECK (current_stage IN ('on_progress','finish')) DEFAULT 'on_progress',

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE pending_edits (
  id UUID PRIMARY KEY DEFAULT uuid(),
  project_id UUID REFERENCES projects(id),   -- NULL when this pending edit is a NEW row proposal
  requested_by UUID NOT NULL REFERENCES users(id),
  edit_type VARCHAR NOT NULL CHECK (edit_type IN ('CREATE','UPDATE')),
  changes_json VARCHAR NOT NULL,             -- JSON string, field:proposedValue map
  status VARCHAR NOT NULL CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  review_note VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  reviewed_at TIMESTAMP
);

CREATE TABLE sessions (                      -- enables server-side JWT revocation
  id UUID PRIMARY KEY DEFAULT uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  refresh_token_hash VARCHAR NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);
```

**Notes / deltas from your original spec:**
- Added `edit_type` to `pending_edits` — your workflow explicitly says staff can "submit a new row" as well as edit existing ones, so `pending_edits` needs to represent both cases. `project_id` is nullable for `CREATE` proposals.
- Added `password_hash`, `is_active` to `users` — required for real auth (not in your original schema, but implied by "Local JWT/session auth").
- Added `market_segments` as a real table rather than a loose config blob, since Settings needs to add/edit/deactivate these values.
- Added `sessions` table for refresh-token revocation (offboarding a staff member should immediately kill their session).
- Added `drive_folder_id` to `projects` — needed to reliably resolve the Drive deep link (matching on folder *name* is fragile if folders get renamed).

### 3.1.1 Implemented schema (deltas from the v1.0 DDL above)

The live DDL lives in `apps/server/src/db/migrate.ts` (idempotent `CREATE TABLE IF NOT EXISTS`, safe to run on every boot). Compared to §3.1 as originally written, the implementation differs:

- **IDs are `VARCHAR PRIMARY KEY`, not `UUID DEFAULT uuid()`.** DuckDB's Node bindings have no native `uuid()` default, so every id is an app-generated UUID string (`apps/server/src/lib/uuid.ts`) supplied explicitly on INSERT.
- **Foreign-key constraints are dropped** (plain `VARCHAR` columns). DuckDB can't `UPDATE` rows in a table that is the target of an FK, so `projects.staff_assigned_id`, `pending_edits.project_id`, etc. are not declared as FKs — referential integrity is enforced at the app layer. (Mirrors existing comments in `migrate.ts`.)
- **`projects` gained `pic_id` (VARCHAR) and `issues` (VARCHAR).** The original free-text `pic` column is migrated away: on boot, if `pic` exists and `pic_id` doesn't, `migrateColumns()` renames `pic → pic_id` and clears old values (a free-text name can't be mapped to a user deterministically). `pic_id` is a user reference resolved to `pic_name` via a left join.
- **Three new tables** beyond the original DDL:
  - `notifications` — in-app alerting (types `NEW_APPROVAL`, `AGING_ALERT`).
  - `dashboard_views` — per-user chart views (pie/bar of a whitelisted column).
  - `aging_thresholds` — singleton `'default'` row seeding the Aging→Priority thresholds.
- **`v_users_public` view** (`CREATE OR REPLACE VIEW`) selects `users` **without `password_hash`**; `users.parquet` is exported from this view, never the raw table.
- Migration extras: `migrateColumns()` (ALTER TABLE to add `pic_id`/`issues` when missing, then re-exports `projects.parquet`), `seedAgingThresholds()` (inserts the `'default'` thresholds row from shared constants), and `importLegacySnapshots()` (imports `projects.parquet`/`pending_edits.parquet` into empty tables on first boot — `users` is never imported since it must be created by the seed script with proper argon2 hashes).

### 3.1.2 Parquet export contract (implemented)

`exportSnapshots(['projects' | 'pending_edits' | 'users'])` in `apps/server/src/db/export.ts` re-`COPY`s the listed tables to Parquet. Only `projects`, `pending_edits`, and `users` are ever exported. `users.parquet` is exported from `v_users_public`. The operational/config tables **`notifications`, `dashboard_views`, and `aging_thresholds` are never exported** — their write routes must not call `exportSnapshots`.

### 3.2 Parquet Export Mapping

After every committed transaction touching a table, the server runs:
```sql
COPY projects TO '/data/parquet/projects.parquet' (FORMAT PARQUET);
COPY users TO '/data/parquet/users.parquet' (FORMAT PARQUET);           -- password_hash excluded, see below
COPY pending_edits TO '/data/parquet/pending_edits.parquet' (FORMAT PARQUET);
```
As implemented (see §3.1.2), `exportSnapshots(table)` only re-Copies the **affected** table(s)
inside the same write-mutex block — it does not dump all three files after every write. The
exclusion contract stands: only `projects`, `pending_edits`, and `users` are ever exported, never
`notifications`, `dashboard_views`, or `aging_thresholds`.
`users.parquet` is exported from the `v_users_public` view that excludes `password_hash` — the raw table is never dumped to the portable snapshot file.

---

## 4. Backend Architecture

### 4.1 Folder Structure (implemented)

```
apps/server/
  src/
    db/
      connection.ts        # singleton DuckDB connection + async write mutex (runWrite/runRead)
      migrate.ts           # idempotent DDL + column/seed migrations + legacy parquet import
      export.ts            # exportSnapshots() / readSnapshot() (projects, pending_edits, users)
    modules/
      auth/                # login, refresh, logout, /me, dev-switch-role (dev only)
      users/               # user CRUD lives under settings/ (see below)
      projects/            # list (scoped/sorted/paginated), assignable users, ROLE-BRANCH writes
      pending-edits/       # submit create/update, list, mine, diff, approve, reject
      settings/            # market_segments CRUD + users + aging-thresholds (+ agingThresholdsCache)
      notifications/       # in-app alerts (list, unread-count, mark read/read-all)
      dashboard/           # per-user views CRUD + chart-data aggregation
      drive/               # Drive resolve + lazy browse + createProjectFolder
      google/              # shared service-account auth client, root-root_folder resolution
    jobs/
      agingCron.ts         # node-cron 07:00 aging-alert check (Gmail digest pending — see §7.3)
    middleware/
      requireAuth.ts
      requireRole.ts
      rateLimit.ts         # fixed-window in-memory limiter (login)
      # auditLog.ts        # NOT implemented yet (Phase 7)
    lib/
      uuid.ts              # app-generated UUID string ids
    app.ts                 # API routers only; no static SPA serving yet (see §11)
    server.ts              # bootstrap (migrate → google init → cron), graceful shutdown
    seed.ts                # CLI-only first SUPER_ADMIN + default market segments
  data/
    app.duckdb
    parquet/               # projects.parquet, pending_edits.parquet, users.parquet
```

### 4.2 Write Serialization Pattern

```ts
// db/connection.ts
import { Database, Connection } from 'duckdb';
import { Mutex } from 'async-mutex';

const db = new Database('data/app.duckdb');
const conn = db.connect();
const writeMutex = new Mutex();

export async function runWrite<T>(sql: string, params: unknown[] = []): Promise<T> {
  return writeMutex.runExclusive(() => execute<T>(sql, params));
}

export async function runRead<T>(sql: string, params: unknown[] = []): Promise<T> {
  return execute<T>(sql, params); // reads are cheap/fast at this scale; no separate pool needed
}
```
Every mutating route handler goes through `runWrite`, which guarantees only one write executes at a time across all concurrent requests from all users, then triggers the relevant table's Parquet export inside the same exclusive block (so the snapshot is never out of sync with the DB even under load).

### 4.3 REST API Surface (implemented)

**Auth**
- `POST /api/auth/login` — email + password → access + refresh token (rate-limited, 10/min/IP)
- `POST /api/auth/refresh` — refresh rotation: revokes the used session, issues a fresh pair
- `POST /api/auth/logout` — revokes the refresh session
- `GET /api/auth/me` — current authenticated user (session restore on page reload)
- `POST /api/auth/dev-switch-role` — **dev-only**, returns 404 when `NODE_ENV === 'production'`

**Projects**
- `GET /api/projects` — RBAC-filtered server-side (STAFF gets only their assigned rows via `scopeClause`; SUPER_ADMIN gets all). Paginated + sortable; derived keys `aging`/`priority` are sorted in-memory after the (≤500-row) scoped fetch.
- `GET /api/projects/users` — active users eligible for PIC / Sales assignment (any authenticated role).
- `POST /api/projects` — SUPER_ADMIN: direct insert (+ auto-create Drive folder when configured). STAFF: creates a `pending_edits` row (`edit_type=CREATE`) → `202`/`submitted`.
- `PATCH /api/projects/:id` — same role branch (`202` + `submitted` for STAFF).
- `DELETE /api/projects/:id` — SUPER_ADMIN only (also removes that project's pending edits).
- *(`GET /api/projects/:id` from the v1.0 plan was never implemented — the grid reads lists, and the diff view uses the pending-edit diff endpoint.)*

**Pending Edits**
- `GET /api/pending-edits?status=pending` — SUPER_ADMIN only
- `GET /api/pending-edits/mine` — STAFF: their own submission history
- `GET /api/pending-edits/:id/diff` — `{ editId, editType, current, proposed, changedFields, conflicts }` (conflicts flag other pending edits touching the same field)
- `POST /api/pending-edits/:id/approve` — applies `changes_json` inside `runWrite` with a re-read of the current row, sets status, exports Parquet
- `POST /api/pending-edits/:id/reject` — sets status + optional `review_note`

**Settings** (entire router gated `requireAuth + requireRole('SUPER_ADMIN')`)
- `GET/POST/PATCH /api/settings/market-segments` (+ PATCH per segment with soft-delete `is_active`)
- `GET/POST/PATCH /api/settings/users` (deactivating a user also revokes their `sessions`)
- `GET/PATCH /api/settings/aging-thresholds` — the `'default'` Low/Medium aging→priority thresholds (cached server-side, invalidated on update)

**Notifications** (*all authenticated roles, per-user scoped*)
- `GET /api/notifications` — this user's notifications (default 50)
- `GET /api/notifications/unread-count`
- `POST /api/notifications/:id/read` — ownership baked into the `UPDATE ... WHERE id = ? AND recipient_id = ?`
- `POST /api/notifications/read-all`

**Dashboard** (*all authenticated roles, per-user views*)
- `GET/POST /api/dashboard/views`, `DELETE /api/dashboard/views/:id` (ownership in WHERE)
- `GET /api/dashboard/chart-data?column=...` — grouped counts for a column, validated against the `DASHBOARD_COLUMNS` whitelist before SQL interpolation, RBAC-scoped like the grid

**Drive**
- `GET /api/drive/resolve/:projectId` — returns the Drive folder URL for a project from its stored `drive_folder_id` (any role)
- `GET /api/drive/browse?folderId=` — lists one level of children (SUPER_ADMIN, lazy-load tree)
- Folder **auto-creation**: `createProjectFolder()` is called inside the same `runWrite` as project create/approve when Google is configured, so a Drive failure rolls back the whole write.

**Gmail / Digest — NOT IMPLEMENTED (Phase 6B, deferred).** The v1.0 endpoints `POST /api/admin/digest/send-now` and `GET /api/admin/digest/preview` do not exist yet; in-app notifications replaced the digest as the v1 alerting channel.

### 4.4 RBAC Enforcement Pattern

RBAC is enforced **twice**, deliberately:
1. **Query-level** — the `GET /api/projects` SQL always includes `WHERE staff_assigned_id = :userId` when the caller's role is `STAFF`; this is not a client-side filter.
2. **Mutation-level** — `PATCH`/`POST` handlers check role before deciding whether to write directly or route into `pending_edits`, and reject outright if a STAFF user's `staff_assigned_id` in the payload doesn't match their own ID (prevents a staff member proposing edits to someone else's project by guessing an ID).

---

## 5. Approval Queue Workflow — Detailed

1. STAFF submits an edit via the grid UI → `PATCH /api/projects/:id`.
2. Server detects role = STAFF → diffs the incoming payload against the current row → writes one `pending_edits` row with `changes_json` containing **only the changed fields** (not the full row) → returns `202 Accepted` with the pending-edit ID.
3. UI shows a "pending approval" badge on that row/field for the submitting staff member (via `GET /api/pending-edits/mine`).
4. SUPER_ADMIN opens **Approval Dashboard** → `GET /api/pending-edits?status=pending`.
5. Selecting an item calls `GET /api/pending-edits/:id/diff`, rendering a side-by-side table: field name | current value | proposed value, with changed rows highlighted.
6. **Approve** → `POST /api/pending-edits/:id/approve`:
   - `runWrite` opens one exclusive DuckDB transaction
   - Re-reads the current row (guards against a stale diff if another admin approved a conflicting edit moments earlier)
   - If `edit_type=UPDATE`: `UPDATE projects SET ... , updated_at = now() WHERE id = :project_id`
   - If `edit_type=CREATE`: `INSERT INTO projects (...)`
   - Sets `pending_edits.status = 'approved'`, `reviewed_by`, `reviewed_at`
   - Exports affected tables to Parquet
   - Commits
7. **Reject** → sets `status='rejected'` with optional note; no change to `projects`.
8. Both actions are recorded in an audit log (simple `audit_log` table or structured log file — recommend a table if you'll want an "activity history" view later; flag if you want this now vs. later).

**Conflict handling:** if two pending edits target the same field on the same project, the diff view flags this ("another pending edit also modifies this field") so the admin doesn't approve both blindly and silently overwrite one.

---

## 6. Frontend Architecture

### 6.1 Folder Structure (implemented)

```
apps/web/src/
  app/                      # routes (React Router)
    login/
    grid/                   # main spreadsheet view + add-project form + row-edit modal
    approvals/              # approval dashboard (SUPER_ADMIN)
    settings/               # market segments / users / aging thresholds (SUPER_ADMIN)
    dashboard/              # per-user chart Dashboard (all roles)
    drive-browser/          # Drive tree browser (SUPER_ADMIN)
  components/
    data-grid/
      ProjectTable.tsx      # TanStack Table + virtualization, inline EditableCell, hover pencil
      EditProjectModal.tsx  # full-row editor (hover project name → pencil)
      columns.tsx           # column defs (text/number/select/date/textarea/user factories)
      ColumnGroupHeader.tsx # sticky "Project Info / Customer / Vendor" groups
      StatusFlagCell.tsx    # idle/deadline highlighting
    approvals/
      DiffView.tsx          # side-by-side current vs proposed, conflict flags
      ApprovalQueueList.tsx
    dashboard/
      ChartCard.tsx         # recharts Pie/Bar + legend, per view card
      AddViewForm.tsx       # chart type / column / label form
    AppLayout.tsx           # nav, role-aware links, NotificationBell, dev role switcher
    NotificationBell.tsx    # unread badge + dropdown panel (polled)
    ProtectedRoute.tsx      # route guard (roles optional)
    Toast.tsx               # toast system (useToast)
  hooks/
    useProjects.ts          # + useAssignableUsers (PIC/Sales options)
    usePendingEdits.ts
    useAuth.ts
    useSettings.ts          # + useAgingThresholds / useUpdateAgingThresholds
    useNotifications.ts     # list (30s), unread-count (15s), mark-read mutations
    useDrive.ts
    useDashboard.ts         # views CRUD + chart-data
  lib/
    api-client.ts           # fetch wrapper with 401 auto-refresh (deduped)
    projectFields.ts        # FIELD_LABELS / SECTION_OF / FIELD_TYPES — shared by DiffView + modal
    projectStatus.ts        # computeProjectFlag (idle/deadline/finish/ok)
    rbac.ts                 # UX-only role helpers (server is the security boundary)
    tokenStore.ts           # localStorage token persistence
  store/
    auth-store.tsx          # AuthProvider React context (login/restore/logout/switchRole)
```

Routes (`App.tsx`): `/login`, `/grid`, `/dashboard` (any role), `/approvals` + `/settings` +
`/drive-browser` (SUPER_ADMIN only via `ProtectedRoute roles={['SUPER_ADMIN']}`), `/` → `/grid`.
Note: there is no `components/ui/` shadcn folder — the frontend uses hand-rolled Tailwind
components (buttons, inputs, modal, toast) rather than the shadcn CLI-generated set.

### 6.2 Main Grid Behavior (implemented)

- Columns grouped via TanStack Table's `columnGroups`: **Project Info** (sticky left), **Customer Section**, **Vendor Section**. Sortable keys whitelisted server-side include the two derived keys (`aging`, `priority`).
- Field widgets: `text` input, `number` input, `date` picker, `select` (stage / service-or-goods / vendor type), `user` dropdown (PIC, Sales), and `textarea` (Issues — commit on Ctrl/Cmd+Enter or blur). Editable cells commit to `PATCH /api/projects/:id` with only the changed field(s).
- **Row-edit modal:** hovering a project-name cell reveals a pencil icon → `EditProjectModal` (full row, grouped Project info / Customer / Vendor), saving sends **one** PATCH containing only the changed fields. STAFF sees "Change submitted for approval.", SUPER_ADMIN sees "Saved.".
- **Status flags** (`computeProjectFlag` in `lib/projectStatus.ts`): `finish` / `deadline` (within `DEADLINE_WARNING_DAYS` of a contract end) / `idle` (`on_progress`, no `updated_at` activity for `IDLE_THRESHOLD_DAYS`) / `ok`. Thresholds are imported from `packages/shared/src/thresholds.ts` — never re-hardcoded.
- **Aging** and **Priority** columns are read-only, unsortable client-side. Aging is computed with `computeAging()` from `@tracker/shared`; Priority is the server-computed badge (green Low / amber Medium / red High) derived from the configurable aging thresholds.
- Pending-edit awareness for STAFF (`GET /api/pending-edits/mine`): a computed `pendingProjectIds` set drives an amber "Pending" indicator on rows awaiting approval (the `pending_flag` column exists in `columns.tsx` though it's currently commented out of the visible grid).
- The add-project form supports Project name, Folder, Customer, segment, Vendor, prices, Type, Stage, Sales (admin only), PIC, and Issues. "Propose new project" for STAFF.

### 6.3 Dashboard, Settings, and Drive Browser Pages

- **Settings** (SUPER_ADMIN): market segment CRUD (soft-delete via `is_active`), user management (create / change role / deactivate — deactivation revokes `sessions`, and a user can't deactivate/demote themselves), and the **Aging → Priority** thresholds panel (two number inputs, save disabled unless `medium > low`, mirrors the zod `.refine`).
- **Dashboard** (all roles): per-user grid of view cards; each view is a Pie or Bar chart of one column from the `DASHBOARD_COLUMNS` whitelist (`current_stage`, `service_or_goods`, `vendor_type`, `market_segment`, `staff_assigned_id`, `pic_id`, `priority`). Views are not shared.
- **Drive Browser** (SUPER_ADMIN): lazy one-level tree from the cached root folder; folder click loads children; "Open in Drive" uses the stored folder id / webViewLink.

---

## 7. Google Integration Details

> **Status:** Phase 6A (Google Drive) is **implemented**. Phase 6B (Gmail digest) is **not started** —
> the daily digest was deferred in favor of in-app notifications (see §10.2). The `googleapis`
> dependency and `.env` digest variables exist but the Gmail code paths are not written.

### 7.1 Service Account Setup (required before first Google call)

1. In Google Cloud Console, create a project → enable **Drive API** and **Gmail API**.
2. Create a service account, download the JSON key, store as `apps/server/secrets/service-account.json` (git-ignored).
3. **Drive access:** Share the Root Storage Drive folder (and each project's folder, or a parent folder that contains them all) with the service account's email address (e.g., `app@project.iam.gserviceaccount.com`) as at least Viewer.
4. **Gmail send access — the step most commonly missed:** a bare service account **cannot** send mail as `admin@yourcompany.com`. You must:
   - Enable **domain-wide delegation** on the service account in the Cloud Console.
   - In the Google Workspace Admin Console (requires Workspace super admin), authorize the service account's Client ID for the scope `https://www.googleapis.com/auth/gmail.send`, impersonating the target admin mailbox.
   - The server then constructs a JWT client with `subject: 'admin@yourcompany.com'` to send "as" that mailbox.
   - **If the organization is not on Google Workspace** (i.e., using plain consumer Gmail), domain-wide delegation is not available — the fallback is OAuth2 with a stored refresh token for one designated Gmail account, or an SMTP app password via Nodemailer. Confirm which applies before building §7.3.

### 7.2 Drive Deep Links & Browser (implemented)

- Store `drive_folder_id` on each project row at creation time. **Auto-created**: `createProjectFolder(projectName)` creates a subfolder under the cached `root_folder` inside the same `runWrite` as project create/approve, so a Drive failure rolls the write back (no orphaned project). When Google is not configured, folder creation is skipped and the app still works.
- Deep link = `https://drive.google.com/drive/folders/{drive_folder_id}` (grid "Folder" column) or the Drive Browser's `webViewLink`.
- **Drive Browser tab:** calls `files.list(q="'{folderId}' in parents and trashed = false", ...)` lazily — one level per folder expand, not an eager full recursive tree (avoids Drive API rate limits at 50–500 projects).
- Root folder is a Drive folder named exactly **`root_folder`**, resolved once at startup (`resolveRootFolderId()`, cached); it must be shared with the service account as Editor so subfolders can be created. Boot fails loudly if configured but the folder is missing; if Google isn't configured at all the server boots with a warning.

### 7.3 Daily Digest Job — NOT IMPLEMENTED (Phase 6B)

- Plan (from `pre_phase_6.md`): `node-cron` daily 06:00; idle = `current_stage = 'on_progress' AND updated_at < now() - INTERVAL 14 DAY`; upcoming deadline = `customer_end_contract`/`vendor_end_contract` within 7 days; HTML-table email sent via `gmail.users.messages.send` with the impersonated JWT client.
- Superseded for v1 by in-app notifications (`notifications` table + `jobs/agingCron.ts` at 07:00) — the alerting requirement is met in-app; the Gmail path remains the plan for when an email channel is wanted. Requires the Workspace domain-wide-delegation decision in §7.1 (item 4) before any code lands.

---

## 8. Automatic Reminder Logic (shared constants)

Define once in `packages/shared/src/thresholds.ts`:
```ts
export const IDLE_THRESHOLD_DAYS = 14;
export const DEADLINE_WARNING_DAYS = 7;
export const AGING_ALERT_DAYS = 30;                    // aging-cron threshold
export const DEFAULT_AGING_LOW_MAX_DAYS = 15;          // seed for aging_thresholds
export const DEFAULT_AGING_MEDIUM_MAX_DAYS = 30;
```
These are the single source of truth: the frontend grid highlighting (`projectStatus.ts`),
the aging cron (`agingCron.ts`), the Aging→Priority seed row (`migrate.ts`), and (when built)
the digest job all import them — never hardcode the numbers in two places.

Aging itself is computed by `networkDays()`/`computeAging()` in `packages/shared/src/lib/aging.ts`
(a business-day `NETWORKDAYS(Q,U)-1`-style port of the source spreadsheet, no holiday awareness),
and `computePriority(aging, thresholds)` maps an aging value to `low`/`medium`/`high`.

---

## 9. Security Considerations (LAN deployment, still worth doing properly)

- Passwords hashed with `argon2`, never stored/logged in plaintext.
- JWT access tokens short-lived (e.g., 15 min); refresh tokens stored hashed in `sessions` table so they can be revoked server-side on deactivation/logout.
- Even on a trusted LAN, enable HTTPS via a self-signed cert or an internal CA if the office network isn't fully trusted (e.g., shared with guest Wi-Fi) — flag as optional but recommended, not blocking for MVP.
- Service account JSON key and JWT signing secret in `.env`/git-ignored secrets, never committed.
- Rate-limit `/api/auth/login` to blunt brute-force attempts even on an internal network.
- Audit log for approvals/rejections (who approved what, when) — recommended given this is a financial/contract-tracking tool (customer/vendor prices, contract dates).

---

## 10. Step-by-Step Implementation Plan

### Phase 0 — Project Scaffolding
1. Initialize monorepo (npm/pnpm workspaces): `apps/web`, `apps/server`, `packages/shared`.
2. Scaffold `apps/web` with Vite + React + TypeScript; install Tailwind, shadcn/ui, TanStack Table/Query/Virtual.
3. Scaffold `apps/server` with Express + TypeScript; install `duckdb`, `async-mutex`, `jsonwebtoken`, `argon2`, `node-cron`, `googleapis`, `zod`.
4. Set up `packages/shared` with Zod schemas for `Project`, `User`, `PendingEdit`, plus the threshold constants (§8) — imported by both apps.

### Phase 1 — Data Layer
5. Write `db/migrate.ts`: creates `app.duckdb` and runs the DDL (§3.1) if it doesn't exist; if legacy `.parquet` files are supplied, imports them into the corresponding tables on first boot.
6. Implement `db/connection.ts` (singleton connection + write mutex, §4.2) and `db/export.ts` (Parquet export helpers).
7. Seed script: create the first `SUPER_ADMIN` user (via CLI script, not an open endpoint) and a handful of `market_segments`.

### Phase 2 — Auth & RBAC
8. Implement `/api/auth/login`, `/refresh`, `/logout`; `requireAuth` and `requireRole` middleware.
9. Implement the dev-only mock role switcher, explicitly disabled outside `NODE_ENV=development`.
10. Frontend: login page, auth store, protected route wrapper, role-aware nav.

### Phase 3 — Core Grid (read path first)
11. Backend: `GET /api/projects` with RBAC filtering, pagination, sort.
12. Frontend: `ProjectTable` with TanStack Table + virtualization, sticky column groups, status-flag cell rendering using shared thresholds (§8).
13. Wire up `useProjects` (TanStack Query) with loading/error states.

### Phase 4 — Write Path & Approval Queue
14. Backend: `POST`/`PATCH /api/projects` with the SUPER_ADMIN-direct vs. STAFF-pending branch logic.
15. Backend: full `pending-edits` module (list, diff, approve, reject) per §5, including the conflict-flagging check.
16. Frontend: inline cell editing in the grid; pending-edit badges for STAFF's own rows.
17. Frontend: Approval Dashboard with `DiffView` and Approve/Reject actions.
18. End-to-end test: STAFF submits edit → appears in queue → Admin approves → grid reflects change → Parquet files verified up to date (`duckdb` CLI spot-check).

### Phase 5 — Settings
19. Backend + frontend: market segment CRUD (soft-delete via `is_active`).
20. Backend + frontend: user management (role changes, activate/deactivate + session revocation on deactivate).

### Phase 6 — Google Integrations
21. Service account setup per §7.1 (this step involves Workspace admin console access — coordinate with whoever holds that role before starting).
22. Backend: Drive resolve + browse endpoints; frontend Drive Browser tab (lazy-loaded tree).
23. Backend: digest query + HTML template + Gmail send function; manual `send-now`/`preview` endpoints for testing before scheduling.
24. Wire up `node-cron` job; verify with a manual trigger, then leave scheduled.

### Phase 7 — Hardening & Deployment
25. Add audit logging for approvals/rejections and auth events.
26. Add rate limiting on auth endpoints, finalize `.env`/secrets handling, confirm nothing sensitive lands in `users.parquet`.
27. Production build: `apps/web` built and served as static files by Express; single process, single port.
28. Decide on and configure HTTPS (self-signed/internal CA) if warranted (§9).
29. Document the LAN access URL/hostname and onboarding steps for staff.

---

### 10.1 Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 0 — Project Scaffolding** | ✅ Complete | Monorepo workspaces; `apps/web` (Vite + React + TS + Tailwind + TanStack Table/Query/Virtual + recharts); `apps/server` (Express + TS + duckdb/async-mutex/jsonwebtoken/argon2/node-cron/googleapis/zod); `packages/shared` with Zod schemas + thresholds. |
| **Phase 1 — Data Layer** | ✅ Complete | `db/connection.ts` (singleton + `runWrite` async-mutex), `db/migrate.ts` (idempotent DDL + column migrations + threshold seed + legacy parquet import), `db/export.ts`. `app.duckdb` + WAL + parquet snapshots present (projects/users on disk; pending_edits exported on first write). |
| **Phase 2 — Auth & RBAC** | ✅ Complete | `modules/auth/` (login w/ rate limit, refresh with rotation, logout, `/me`, `dev-switch-role` dev-only, argon2); `middleware/requireAuth.ts`, `requireRole.ts`, `rateLimit.ts`; frontend `auth-store.tsx` context + `useAuth` + `api-client` with deduped 401 refresh. |
| **Phase 3 — Core Grid (read path)** | ✅ Complete | `components/data-grid/` (ProjectTable w/ virtualization + sticky groups + inline `EditableCell`, ColumnGroupHeader, StatusFlagCell, typed column factories); `hooks/useProjects.ts`; `app/grid/GridPage.tsx`. Sortable server-side incl. derived `aging`/`priority` (in-memory). |
| **Phase 4 — Write Path & Approval Queue** | ✅ Complete | `modules/projects/` (role-branch POST/PATCH/DELETE), `modules/pending-edits/` (submit-create/update, list, mine, diff-with-conflicts, approve w/ re-read inside mutex + transaction, reject); `components/approvals/` (DiffView, ApprovalQueueList); `ApprovalsPage`. |
| **Phase 5 — Settings** | ✅ Complete | `modules/settings/` (market segments soft-delete, users incl. session revocation on deactivate + self-lockout guard, **aging thresholds**); `useSettings.ts`; `SettingsPage` w/ `AgingThresholdsPanel`. |
| **Phase 6A — Google Drive** | ✅ Complete | `modules/google/auth.ts` (service-account client, root-`root_folder` resolution, configured-or-degrade); `modules/drive/` (resolve, listChildren lazy browse, `createProjectFolder` called inside create/approve `runWrite` for all-or-nothing); `app/drive-browser/` UI + grid Folder column. |
| **Phase 6B — Gmail Digest** | ⬜ Not Started | **Deferred** — replaced for v1 by in-app notifications (§10.2). `pre_phase_6.md` retains the plan (send-now/preview endpoints, `jobs/digestJob.ts`, digest HTML). |
| **Phase 7 — Hardening & Deployment** | 🟡 Partial | Done: login rate limiting, `.env`/secrets handling, `users.parquet` excludes `password_hash` (exported from `v_users_public`), graceful shutdown w/ DuckDB `CHECKPOINT`, `closeDb`. **Remaining:** audit logging (approval/rejection/auth events), Express serving the built SPA in production, HTTPS decision, LAN access docs. |

### 10.2 Implemented Extensions (added after the v1.0 plan)

These shipped as follow-ups and are now part of the current spec. Planning docs: `planning_ex8.md`, `planning_ex9.md`, `pre_phase_6.md`.

**1. PIC / Issues / Aging columns** (planning_ex8)
- `projects.pic_id` (user reference, JOINed to `pic_name`) and `projects.issues` (free-text notes, textarea widget). Grid: PIC is a `user` dropdown, Issues is a `<textarea>`, Aging is a non-editable computed column.
- `Aging` is **derived**, never stored: `networkDays(project_sent_date, approval_date ?? today) - 1` (business days, no holidays) in `packages/shared/src/lib/aging.ts`. The earlier free-text PIC column is migrated to `pic_id` and its values cleared.

**2. In-app notifications** (planning_ex8) — the v1 alerting channel
- `notifications` table (types `NEW_APPROVAL`, `AGING_ALERT`). `NEW_APPROVAL` rows are created inside the same `runWrite` as a pending-edit submission — one per active SUPER_ADMIN.
- `jobs/agingCron.ts` runs daily at 07:00: computes Aging for all `on_progress` projects and alerts all active SUPER_ADMINs when Aging ≥ `AGING_ALERT_DAYS` (30), de-duplicated by an existing unread AGING_ALERT for that project. Wrapped in try/catch — a bad run never crashes the process.
- Frontend `NotificationBell` in the header (all roles) polls unread count every 15s and the list every 30s; click navigates to `/approvals` (NEW_APPROVAL) or `/grid` (AGING_ALERT). Reads are per-user scoped.
- **Not** part of the Parquet export contract.

**3. Aging → Priority with configurable thresholds** (planning_ex9)
- `aging_thresholds` singleton `'default'` row seeded from `DEFAULT_AGING_LOW_MAX_DAYS`/`DEFAULT_AGING_MEDIUM_MAX_DAYS` (15/30). SUPER_ADMIN edits via Settings (`GET/PATCH /api/settings/aging-thresholds`); server caches via `agingThresholdsCache.ts`, invalidated on update.
- `priority` is **always derived** (`computePriority(computeAging(row), thresholds)`) — never stored, never submittable (deliberately omitted from the create/update Zod schemas). Computed server-side in `listProjects` and in dashboard chart-data; rendered as a read-only badge in the grid.
- **Not** part of the Parquet export contract.

**4. Per-user Dashboard** (planning_ex9)
- `dashboard_views` table + `GET/POST/DELETE /api/dashboard/views` + `GET /api/dashboard/chart-data?column=`. The column is validated against the single `DASHBOARD_COLUMNS` whitelist (`packages/shared/src/schemas/dashboardView.ts`) before any SQL interpolation, and aggregated over the **same `scopeClause`** as the grid (extracted for exactly this reason — grid and dashboard can't diverge on STAFF row-scoping).
- recharts Pie/Bar cards with legends; views are per-user. **Not** part of the Parquet export contract.

**5. Row-edit modal** (planning_ex9 Phase 5)
- Hover a project-name cell → pencil → `EditProjectModal` renders the full row grouped into Project info / Customer / Vendor (`lib/projectFields.ts` centralizes `FIELD_LABELS`/`SECTION_OF`/`FIELD_TYPES`, shared with `DiffView`). Save sends **one** PATCH with only the changed fields (client-side diff). Per the recorded decision, the modal duplicates field-rendering logic rather than extracting a shared `FieldInput`.

**6. Google Drive (Phase 6A)** — see §7.2.

**7. Playwright E2E suite**
- 5 spec files / 17 tests in `apps/web/e2e/`: `grid.spec.ts`, `notifications.spec.ts`, `dashboard.spec.ts`, `priority.spec.ts`, `edit-modal.spec.ts`. `playwright.config.ts` boots the API server (port 3000, `npm run start -w @tracker/server`) + Vite dev (port 5173).
- Known dev caveats recorded in `planning_ex9.md` Batch 4: the full suite needs the `_rbac_setup.ts` fixture database (`staff1@example.com`/`Admin Project A`, etc.); the live `apps/server/data/app.duckdb` currently holds manual dev rows, so the fixture-based specs can't run against it without resetting the DB. `notifications.spec.ts`'s exact `'1'` badge assert can flake if run in parallel with edit-modal's STAFF submit.
- Typecheck note: the web workspace has 3 pre-existing TS6133 "declared but never used" errors (`ColumnGroupHeader.tsx` `headerWidth`, `columns.tsx` `statusColumn`/`pendingColumn`); per the project rule these are left in place, and `npx vite build` (bypassing the `tsc` gate) is used to verify the build.

---

## 11. Open Items / Remaining Work

*(Storage engine and Phase 6A architecture — §1.2/§1.3 — are confirmed and implemented.)*

**Outstanding implementation work:**
- **Phase 6B — Gmail digest.** Not started; superseded for v1 by in-app notifications. To build it later you'll need the Workspace/domain-wide-delegation decision from §7.1 item 4 (or the consumer-Gmail OAuth/SMTP fallback), a real `DIGEST_RECIPIENT_EMAIL`, and the `send-now`/`preview` endpoints + `jobs/digestJob.ts` from `pre_phase_6.md`.
- **Audit logging (Phase 7).** Nothing is recorded today for approvals/rejections/auth events beyond the `pending_edits.reviewed_by/reviewed_at` columns. Decide table vs. structured logs if an "activity history" UI is wanted.
- **Production single-process deployment.** Express does not yet serve the built SPA (`apps/server/src/app.ts` is API-only); `apps/web` is still run via Vite dev. Needs `express.static` of the Vite build + same-origin serving.
- **HTTPS decision (Phase 7)** for the LAN (self-signed/internal CA) if the network isn't fully trusted.
- **LAN docs** — access URL/hostname and staff onboarding steps.

**Decisions still needed before Phase 6B:**
- Confirm the Google Workspace assumption (§1.3) — determines the exact Gmail auth path.
- Confirm digest send time (assumed 06:00 server-local) and recipients (single SUPER_ADMIN via `DIGEST_RECIPIENT_EMAIL`, or all active SUPER_ADMINs).

**Dev-environment notes:**
- The live `apps/server/data/app.duckdb` is out of sync with the E2E fixtures (it holds manual dev rows instead of `staff1@example.com` / `Admin Project A` etc.). The Playwright suite that depends on fixtures requires re-running the fixture setup, which is destructive to the manual rows.
- `notifications.spec.ts`'s exact unread-badge assert (`'1'`) can flake if the suite runs its STAFF-submit tests in parallel workers.
