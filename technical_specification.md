# Technical Specification & Implementation Plan
## AppSheet-Style Administrative Project Tracking Web App

**Version:** 1.0
**Author:** Senior Software Architect (Claude)
**Deployment context:** Small team, LAN, 2–10 concurrent users, 10–50 staff accounts, 50–500 projects
**Google integration:** Single shared service account

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
| Styling/UI | Tailwind CSS + shadcn/ui |
| Data grid | TanStack Table v8 (headless) + TanStack Virtual (row virtualization for 500-row grids) |
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

### 3.2 Parquet Export Mapping

After every committed transaction touching a table, the server runs:
```sql
COPY projects TO '/data/parquet/projects.parquet' (FORMAT PARQUET);
COPY users TO '/data/parquet/users.parquet' (FORMAT PARQUET);           -- password_hash excluded, see below
COPY pending_edits TO '/data/parquet/pending_edits.parquet' (FORMAT PARQUET);
```
`users.parquet` is exported from a view that excludes `password_hash` — the raw table is never dumped to the portable snapshot file.

---

## 4. Backend Architecture

### 4.1 Folder Structure

```
apps/server/
  src/
    db/
      connection.ts        # singleton DuckDB connection + write mutex
      migrate.ts            # runs DDL on first boot, imports existing parquet if present
      export.ts             # COPY ... TO parquet helpers, called after every write
    modules/
      auth/                  # login, refresh, logout, mock-switcher (dev only)
      users/
      projects/
      pending-edits/
      settings/              # market_segments CRUD
      drive/                 # Drive link resolution + file-tree browse
      gmail/                 # digest generation + send
    jobs/
      dailyDigest.ts         # node-cron entrypoint
    middleware/
      requireAuth.ts
      requireRole.ts
      auditLog.ts
    app.ts
    server.ts
  data/
    app.duckdb
    parquet/
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

### 4.3 REST API Surface

**Auth**
- `POST /api/auth/login` — email + password → access + refresh token
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/dev-switch-role` — **dev-only**, gated behind `NODE_ENV !== 'production'`

**Projects**
- `GET /api/projects` — RBAC-filtered server-side (STAFF gets only their assigned rows; SUPER_ADMIN gets all). Supports pagination/sort/filter query params.
- `GET /api/projects/:id`
- `POST /api/projects` — SUPER_ADMIN: direct insert. STAFF: creates a `pending_edits` row (`edit_type=CREATE`) instead, response indicates "submitted for approval."
- `PATCH /api/projects/:id` — same branch: SUPER_ADMIN writes directly; STAFF creates a `pending_edits` row (`edit_type=UPDATE`).
- `DELETE /api/projects/:id` — SUPER_ADMIN only.

**Pending Edits**
- `GET /api/pending-edits?status=pending` — SUPER_ADMIN only
- `GET /api/pending-edits/:id/diff` — returns `{ current: {...}, proposed: {...}, changedFields: [...] }`
- `POST /api/pending-edits/:id/approve` — applies `changes_json` to `projects` via `runWrite`, sets status
- `POST /api/pending-edits/:id/reject` — sets status + optional `review_note`
- `GET /api/pending-edits/mine` — STAFF: see their own submission history/status

**Settings**
- `GET/POST/PATCH /api/settings/market-segments`
- `GET/POST/PATCH /api/settings/users` — SUPER_ADMIN manages roles/active status

**Drive**
- `GET /api/drive/resolve/:projectId` — returns the Drive folder URL for a project
- `GET /api/drive/browse?folderId=` — lists children of the Root Storage folder or a subfolder (proxies Drive API, service account must have at least Viewer access to the root folder — see §7)

**Gmail / Digest**
- `POST /api/admin/digest/send-now` — manual trigger for testing (SUPER_ADMIN only)
- `GET /api/admin/digest/preview` — renders the HTML digest without sending

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

### 6.1 Folder Structure

```
apps/web/src/
  app/                      # routes (React Router)
    login/
    grid/                   # main spreadsheet view
    approvals/              # approval dashboard
    settings/
    drive-browser/
  components/
    data-grid/
      ProjectTable.tsx       # TanStack Table + virtualization
      ColumnGroupHeader.tsx  # sticky "Project Info / Customer / Vendor" groups
      StatusFlagCell.tsx     # idle/deadline highlighting
    approvals/
      DiffView.tsx
      ApprovalQueueList.tsx
    ui/                     # shadcn components
  hooks/
    useProjects.ts           # TanStack Query wrappers
    usePendingEdits.ts
    useAuth.ts
  lib/
    api-client.ts
    rbac.ts
  store/
    auth-store.ts            # Zustand or React context for current user/role
```

### 6.2 Main Grid Behavior

- Columns grouped via TanStack Table's `columnGroups`: **Project Info** (sticky left), **Customer Section**, **Vendor Section**.
- Inline cell editing (shadcn `Input`/`Select`/`DatePicker` in edit mode) → on blur/confirm, calls `PATCH /api/projects/:id` with only the changed field(s).
- Row-level status flags computed **client-side from server-provided fields** (`current_stage`, `updated_at`, `*_end_contract`) but the *thresholds* (14 days idle, 7 days to deadline) should live as constants in `packages/shared` so frontend and the Gmail digest job use identical logic — avoids the UI and the email disagreeing about what counts as "idle."
- Cells with an outstanding pending edit (for STAFF's own submissions) render a small amber indicator + tooltip showing proposed value and status.

### 6.3 Settings Page

- Market segment CRUD (add/deactivate — avoid hard delete if segments are referenced by existing rows; use `is_active` soft-delete).
- User management: list users, change role, activate/deactivate (deactivating should also revoke their `sessions` rows).

---

## 7. Google Integration Details

### 7.1 Service Account Setup (do this before writing integration code)

1. In Google Cloud Console, create a project → enable **Drive API** and **Gmail API**.
2. Create a service account, download the JSON key, store as `apps/server/secrets/service-account.json` (git-ignored).
3. **Drive access:** Share the Root Storage Drive folder (and each project's folder, or a parent folder that contains them all) with the service account's email address (e.g., `app@project.iam.gserviceaccount.com`) as at least Viewer.
4. **Gmail send access — the step most commonly missed:** a bare service account **cannot** send mail as `admin@yourcompany.com`. You must:
   - Enable **domain-wide delegation** on the service account in the Cloud Console.
   - In the Google Workspace Admin Console (requires Workspace super admin), authorize the service account's Client ID for the scope `https://www.googleapis.com/auth/gmail.send`, impersonating the target admin mailbox.
   - The server then constructs a JWT client with `subject: 'admin@yourcompany.com'` to send "as" that mailbox.
   - **If the organization is not on Google Workspace** (i.e., using plain consumer Gmail), domain-wide delegation is not available — the fallback is OAuth2 with a stored refresh token for one designated Gmail account, or an SMTP app password via Nodemailer. Confirm which applies before building §7.3.

### 7.2 Drive Deep Links & Browser

- Store `drive_folder_id` on each project row at creation time (resolved once via a Drive `files.list` search by name under the root, or entered manually in the create form).
- Deep link = `https://drive.google.com/drive/folders/{drive_folder_id}`, opened in a new tab.
- **Drive Browser tab:** calls `files.list(q="'{folderId}' in parents", ...)` recursively/on-demand (lazy-load children on folder expand, not a full recursive tree fetch up front — with 50–500 projects each potentially having their own folder, an eager full tree walk would be slow and hit Drive API rate limits).

### 7.3 Daily Digest Job

- `node-cron` schedule, e.g. `0 6 * * *` (06:00 server local time).
- Query: idle = `current_stage = 'on_progress' AND updated_at < now() - INTERVAL 14 DAY`; upcoming deadline = `customer_end_contract BETWEEN today AND today + 7` OR same for `vendor_end_contract`.
- Render HTML via a small template (can reuse a React server-rendered email template or a plain Handlebars/EJS template — recommend a simple table-based HTML email, since rich CSS support in Gmail is limited).
- Send via `gmail.users.messages.send` (base64url-encoded RFC 2822 MIME message) using the impersonated JWT client from §7.1.
- Log each send (success/failure) — a failed send shouldn't crash the cron job; catch and log, retry next day.

---

## 8. Automatic Reminder Logic (shared constants)

Define once in `packages/shared/src/thresholds.ts`:
```ts
export const IDLE_THRESHOLD_DAYS = 14;
export const DEADLINE_WARNING_DAYS = 7;
```
Both the frontend grid highlighting and the backend digest query import these — never hardcode the numbers in two places.

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
| **Phase 0 — Project Scaffolding** | ✅ Complete | Monorepo structure with workspaces; `apps/web` scaffolded (Vite + React + Tailwind + TanStack); `apps/server` scaffolded (Express + TypeScript + all npm packages); `packages/shared` with Zod schemas + thresholds. |
| **Phase 1 — Data Layer** | ✅ Complete | `db/connection.ts` (singleton + write mutex), `db/migrate.ts`, `db/export.ts` implemented. `app.duckdb` + WAL + parquet snapshots present. |
| **Phase 2 — Auth & RBAC** | ✅ Complete | `modules/auth/` (login, refresh, logout, tokens, config, authService); `middleware/requireAuth.ts`, `requireRole.ts`, `rateLimit.ts`; `auth-store.tsx` + `useAuth.ts` on frontend. |
| **Phase 3 — Core Grid (read path)** | ✅ Complete | `components/data-grid/` (ProjectTable, ColumnGroupHeader, StatusFlagCell, columns); `hooks/useProjects.ts`; `app/grid/GridPage.tsx`. |
| **Phase 4 — Write Path & Approval Queue** | ✅ Complete | `modules/projects/` (routes + service); `modules/pending-edits/` (routes + service); `components/approvals/` (DiffView, ApprovalQueueList); `app/approvals/ApprovalsPage.tsx`. |
| **Phase 5 — Settings** | ✅ Complete | `modules/settings/` (routes + settingsService); `hooks/useSettings.ts`; `app/settings/SettingsPage.tsx`. |
| **Phase 6 — Google Integrations** | ⬜ Not Started | Missing: `modules/drive/`, `modules/gmail/`, `jobs/dailyDigest.ts`, `app/drive-browser/` on frontend. |
| **Phase 7 — Hardening & Deployment** | ⬜ Not Started | Rate limiting implemented; audit logging, HTTPS config, production build steps remain. |

---

## 11. Open Items to Confirm Before/During Build

*(Storage engine, §1.2/§1.3, is now confirmed — DuckDB native local file as source of truth, Parquet as local snapshots.)*

- Confirm the Google Workspace assumption (§1.3) — determines the exact Gmail auth path in Phase 6.
- Decide whether `audit_log` is a full table (queryable "activity history" UI) or just structured server logs for now — table is recommended if you'll want an activity view later, but it's more upfront work.
- Confirm whether project "folders" are 1:1 with a single Drive folder per project (assumed) or something more nested.
- Confirm digest send time (assumed 06:00 server-local) and recipient(s) — currently scoped to "the Super Admin"; confirm if there are multiple Super Admins and whether all should receive it.
