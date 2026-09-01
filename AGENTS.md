# AGENT.md

Agent context file for **opencode** working on the AppSheet-Style Administrative Project Tracking Web App.

## Project Summary

Internal LAN web app for tracking 50–500 projects across 10–50 staff. STAFF submit edits that require SUPER_ADMIN approval before hitting the live data; the app also resolves Google Drive folders per project and sends a daily digest email of idle/deadline-approaching projects.

- Deployment: single office/LAN machine, 2–10 concurrent users, no public internet exposure required.
- Google integration: one shared service account (Drive + Gmail).

## Required Technical Skills

The agent should use the following technologies rather than substituting
alternatives:

### External Skills

When an installed OpenCode skill provides authoritative or specialized
guidance for a technology used by this project, prefer that guidance
over generic implementation patterns.

Relevant skills include:

- React
- shadcn/ui
- DuckDB
- Playwright/testing
- verification/testing

Skills supplement this file; they do not override the project's
architectural constraints.

If a task touches Google Drive/Gmail auth, DuckDB SQL/WAL semantics, or TanStack Table virtualization, treat those as the higher-risk areas to get right — see gotchas below.

## Source of Truth / Instruction Priority

When implementing or modifying the application, use the following priority:

1. Explicit user instructions in the current task
2. This `AGENTS.md`
3. `technical_specification.md`
4. Existing code and established project conventions
5. General framework/library conventions

Do not silently change architectural decisions from this file or
`technical_specification.md`.

If an implementation requirement conflicts with the specification or
creates a significant architectural decision not covered by the spec,
stop and ask for clarification rather than inventing a solution.

Small implementation details may be chosen autonomously when they do
not affect the architecture, security model, API contract, data model,
or user-facing behavior.

## Technology Constraints

Do not introduce a new framework, database, state-management library,
authentication system, ORM, API framework, or deployment architecture
without explicit approval.

In particular, do not replace:

- DuckDB with PostgreSQL, SQLite, MySQL, etc.
- Express with another backend framework
- JWT/session authentication with an authentication framework
- TanStack Table with another table/grid library
- React/Vite with another frontend framework
- Parquet snapshots with another storage mechanism
- Google APIs with another integration mechanism

Prefer the libraries already specified in this document.

## Authorization Is Server-Owned

The frontend may hide UI elements based on role, but this is only a UX
feature and is never a security boundary.

Every protected API endpoint must independently verify:

1. The caller is authenticated.
2. The caller's role permits the operation.
3. The caller is authorized for the specific resource being accessed.

Never trust:

- role values supplied by the client
- user IDs supplied by the client
- staff assignment supplied by the client
- project ownership claims supplied by the client

Derive authorization from the authenticated server-side user/session.


## Architecture Overview

```
React+Vite SPA  <--REST+JWT-->  Express API (single process)
                                    ├─ write mutex (async-mutex)
                                    ├─ DuckDB native store (app.duckdb, WAL)
                                    │     └─ export → Parquet snapshots (projects/users/pending_edits)
                                    └─ node-cron (06:00) → Gmail digest
                                          └─ Google Drive API / Gmail API (shared service account)
```

Key architectural decisions the agent must respect:

1. **`app.duckdb` is the transactional source of truth.** Parquet files are generated snapshots only, re-exported synchronously after every committed write (inside the same write-mutex block). Never treat Parquet as writable/authoritative.
2. **One writer at a time.** All mutating queries go through `runWrite()`, which acquires a single in-process `async-mutex` lock, executes the SQL, then triggers the relevant Parquet export before releasing. Reads use `runRead()` and share the connection without locking.
3. **Approval workflow is enforced at the data layer, not just the UI.** STAFF never write to `projects` directly. `POST`/`PATCH /api/projects` branches by role:
   - `SUPER_ADMIN` → writes directly to `projects`.
   - `STAFF` → writes a row to `pending_edits` (`edit_type: 'CREATE' | 'UPDATE'`, `changes_json` holds only changed fields) and returns `202 Accepted`.
4. **RBAC is enforced twice**: query-level (`WHERE staff_assigned_id = :userId` injected server-side for STAFF, never a client-side filter) and mutation-level (reject if a STAFF payload's `staff_assigned_id` doesn't match the caller).
5. **Approving a pending edit re-reads the current row first** inside the write-mutex transaction, to guard against a stale diff if another admin approved a conflicting edit moments earlier. The diff view also flags when two pending edits touch the same field on the same project.
6. **Shared thresholds, not duplicated magic numbers.** `IDLE_THRESHOLD_DAYS` (14) and `DEADLINE_WARNING_DAYS` (7) live once in `packages/shared/src/thresholds.ts` and are imported by both the frontend grid highlighting and the backend digest query.
7. **`users.parquet` must never include `password_hash`.** It's exported from a view that excludes it, not the raw table.

## Data Model (DuckDB DDL lives in `apps/server/src/db/migrate.ts`)

Tables: `users`, `market_segments`, `projects`, `pending_edits`, `sessions`.

- `projects` has a Customer section and a Vendor section (dates, prices, contract IDs) plus `drive_folder_id` for deep-linking to Google Drive and `current_stage` (`on_progress` | `finish`).
- `pending_edits.project_id` is nullable — null means the pending edit is a proposed **new** row (`edit_type = 'CREATE'`).
- `sessions` backs refresh-token revocation (deactivating a user must revoke their sessions rows immediately).

## Folder Structure

```
apps/web/src/
  app/                  # routes: login/, grid/, approvals/, settings/, drive-browser/
  components/
    data-grid/          # ProjectTable, ColumnGroupHeader, StatusFlagCell
    approvals/          # DiffView, ApprovalQueueList
    ui/                 # shadcn components
  hooks/                # useProjects, usePendingEdits, useAuth
  lib/                  # api-client, rbac
  store/                # auth-store (Zustand/context)

apps/server/src/
  db/                   # connection.ts (mutex), migrate.ts, export.ts
  modules/               # auth/ users/ projects/ pending-edits/ settings/ drive/ gmail/
  jobs/                  # dailyDigest.ts (node-cron)
  middleware/            # requireAuth, requireRole, auditLog
  app.ts, server.ts

apps/server/data/
  app.duckdb
  parquet/

packages/shared/
  src/thresholds.ts       # IDLE_THRESHOLD_DAYS, DEADLINE_WARNING_DAYS
  (Zod schemas for Project, User, PendingEdit)
```

## Pending Edit Invariants

A pending edit must never directly mutate `projects`.

For STAFF:

- CREATE → pending_edits with `edit_type = CREATE` and `project_id = NULL`
- UPDATE → pending_edits with `edit_type = UPDATE`
- UPDATE changes_json must contain only changed fields
- response status should be 202 Accepted

For SUPER_ADMIN:

- CREATE/UPDATE may modify `projects` directly
- DELETE is SUPER_ADMIN-only

Approval must:

1. Execute inside `runWrite`.
2. Re-read the current project state.
3. Validate the pending edit.
4. Detect/handle conflicts.
5. Apply the change.
6. Update the pending edit status.
7. Export affected Parquet snapshots.
8. Commit atomically.

Never approve an edit based solely on the stale data previously
returned by the diff endpoint.

## Database Schema Changes

Never modify the database schema ad hoc from route handlers.

All schema creation and migrations belong in:

apps/server/src/db/migrate.ts

Schema changes must be:

- deterministic
- safe to run during application startup
- compatible with existing data where applicable
- accompanied by updates to shared TypeScript/Zod types when needed

Do not silently delete or recreate existing production data during
migration.

## REST API Surface (for quick reference)

- **Auth:** `POST /api/auth/login|refresh|logout`, `POST /api/auth/dev-switch-role` (dev-only, must be gated on `NODE_ENV !== 'production'`)
- **Projects:** `GET /api/projects` (RBAC-filtered, paginated), `GET/PATCH/DELETE /api/projects/:id`, `POST /api/projects`
- **Pending Edits:** `GET /api/pending-edits?status=pending`, `GET /api/pending-edits/:id/diff`, `POST /api/pending-edits/:id/approve|reject`, `GET /api/pending-edits/mine`
- **Settings:** `GET/POST/PATCH /api/settings/market-segments`, `GET/POST/PATCH /api/settings/users`
- **Drive:** `GET /api/drive/resolve/:projectId`, `GET /api/drive/browse?folderId=`
- **Gmail:** `POST /api/admin/digest/send-now`, `GET /api/admin/digest/preview`

## Conventions

- TypeScript everywhere; Zod schemas in `packages/shared` are the single source of truth for shapes used by both client and server.
- Mutating server routes must go through `runWrite`; never call the DuckDB connection directly from a route handler.
- Never hardcode `14`/`7`-day thresholds — import from `packages/shared/src/thresholds.ts`.
- Soft-delete only for `market_segments` (`is_active`), since existing rows may reference a segment by label.
- Password hashing: `argon2` only, never log or export plaintext/hash outside the excluded-view Parquet export.
- Drive folder lazy-loading: `files.list` children are fetched on folder expand, not as an eager full recursive tree (avoids Drive API rate limits at 50–500 projects).

## Secrets and Sensitive Data

Never:

- commit service-account.json
- commit `.env`
- hardcode JWT secrets
- hardcode Google credentials
- log passwords
- log password hashes
- return password_hash through API responses
- include password_hash in Parquet exports

Use environment variables or git-ignored secret files as appropriate.

Before completing a task involving authentication or Google integration,
check that secrets have not been introduced into source code.

## Scope / Avoid Overengineering

This application is intentionally designed for a small internal LAN
deployment.

Do not introduce:

- microservices
- Redis
- message brokers
- Kubernetes
- cloud databases
- distributed locks
- database connection pools
- complex event-driven architecture

unless explicitly requested.

Prefer the simple single-process architecture described above.

## Gotchas / Things Not to Get Wrong

- Gmail send requires **domain-wide delegation** configured by a Workspace super admin (not just a service account key) — the org must be on Google Workspace, not consumer Gmail, or the fallback (OAuth2 refresh token / SMTP app password) is needed instead.
- `drive_folder_id` is stored per project at creation time — don't resolve Drive folders by name lookup at read time (fragile if folders get renamed).
- The dev-only mock role switcher (`/api/auth/dev-switch-role`) must be disabled/unreachable outside development.
- A failed digest send must be caught/logged, not allowed to crash the cron job; it should just retry the next day.

## Decision Escalation

Ask the user before making assumptions that affect:

- database schema
- authentication/authorization
- security
- API contracts
- Google authentication
- data ownership
- approval semantics
- deployment architecture
- destructive data operations

Do not interrupt for trivial implementation details.

For non-critical implementation choices, follow existing project
conventions and choose the simplest reasonable solution.

