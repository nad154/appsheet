# Planning: Customers & Vendors as First-Class Entities

## 0. Goal (as specified)

- `customers` and `vendors` become their own tables — for now, just `id` + `name`.
- Adding a customer/vendor to a project uses a searchable dropdown (type to
  filter) with an "add new" fallback, instead of a free-text field.
- **One project → one customer.** **One project → many vendors.**
- Grid visually groups multi-vendor projects like:

  ```
  [ Project 1 ] [ Customer 1 ] [ Vendor 1 ]
   (blank)  --------------------[ Vendor 2 ]
  ```

## 1. Why this is bigger than "swap a text field for an ID"

Today, `projects` is *both* the project record *and* the one-and-only vendor
deal record. Every "Vendor Section" column in `columns.tsx`
(`vendor_name`, `vendor_revenue`, `vendor_type`, `project_sent_date`,
`project_finish_date`, `vendor_project_id`, `negotiation_date`,
`approval_date`, `document_sent_date`, `document_id`, `vendor_price`,
`vendor_start_contract`, `vendor_end_contract`) — plus **Aging and Priority**,
which are computed from `project_sent_date`/`approval_date`
(`packages/shared/src/lib/aging.ts`) — lives directly on the `projects` row.

Once a project can have >1 vendor, all of those fields can no longer be
project-level columns — they become **per-vendor-line** data. So this isn't
just "add a `vendors` table and a foreign key"; it's:

- `vendors` / `customers`: new lookup tables (id + name), as asked.
- A new **join/detail table**, `project_vendors`, that holds one row per
  (project, vendor) pairing and carries everything that used to be the
  "Vendor Section" — including Aging/Priority inputs, which move from being a
  *project* concept to being a *project-vendor-line* concept.
- `projects.customer_id` replaces `projects.customer_name` (still 1:1, so this
  part is the simple swap you'd expect).
- The grid stops being "one row per project" and becomes "one row per
  project-vendor line, with a project having zero vendor lines still shown as
  one blank-vendor row." This affects sorting, pagination, the dashboard's
  vendor-based charts, and the derived Aging/Priority columns.

None of this is a reason not to do it — it's the correct shape for "many
vendors per project" — but it changes several things you're currently relying
on (see §3), so I'm flagging them explicitly before touching schema, per how
these plans are normally scoped for you.

## 2. Proposed data model

```
customers
  id            VARCHAR PK
  name          VARCHAR NOT NULL
  created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp
                                   -- no is_active — real DELETE, see §3.4

vendors
  id            VARCHAR PK
  name          VARCHAR NOT NULL
  created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp

projects  (unchanged except:)
  - DROP customer_name
  + customer_id  VARCHAR         -- nullable, references customers.id (no FK
                                  --   constraint — DuckDB blocks UPDATE on
                                  --   FK-target tables, same reason
                                  --   staff_assigned_id has none today)
  - DROP vendor_name, vendor_revenue, vendor_type, project_sent_date,
         project_finish_date, vendor_project_id, negotiation_date,
         approval_date, document_sent_date, document_id, vendor_price,
         vendor_start_contract, vendor_end_contract
    (all of these move to project_vendors)

project_vendors                   -- NEW: one row per vendor line on a project
  id                     VARCHAR PK
  project_id             VARCHAR NOT NULL     -- FK dropped, same convention
  vendor_id              VARCHAR NOT NULL     -- FK dropped, same convention
  vendor_type            VARCHAR CHECK (vendor_type IN ('service','goods'))
  vendor_revenue         INTEGER
  project_sent_date      DATE
  project_finish_date    DATE
  vendor_project_id      VARCHAR
  negotiation_date       DATE
  approval_date          DATE
  document_sent_date     DATE
  document_id            VARCHAR
  vendor_price           INTEGER
  vendor_start_contract  DATE
  vendor_end_contract    DATE
  sort_order             INTEGER NOT NULL DEFAULT 0   -- keeps "Vendor 1"
                                                        -- above "Vendor 2"
  created_at             TIMESTAMP NOT NULL DEFAULT current_timestamp
  updated_at             TIMESTAMP NOT NULL DEFAULT current_timestamp
```

`Aging`/`Priority` continue to use the existing `computeAging`/
`computePriority` from `packages/shared/src/lib/aging.ts` unchanged — they
already take a structural `{ project_sent_date, approval_date }` shape
(`AgingInput`), so they just get called with a `ProjectVendor` instead of a
`Project`. No changes needed to that file.

## 3. Decisions (resolved)

**3.1 — Grid row granularity & pagination: never split a project's vendor
lines across a page.** This is possible, and is the adopted design — a
project's lines always land together on one page; if the next project
doesn't fully fit in the remaining space on the current page, the whole
project defers to the next page instead of being split. Concretely, this
changes `listProjects` from "SQL `LIMIT`/`OFFSET` on `projects`" to a
**greedy pack, computed in application code**:

1. Fetch the RBAC-scoped project id list in the requested sort order (same
   query shape as today, minus the row payload), each annotated with its
   `project_vendors` count (`0` counts as `1`, for the blank-vendor row).
2. Walk the ordered list once, accumulating into "pages": keep adding a
   project's line-count to the current page's running total; if adding the
   next project would exceed `page_size` **and** the current page already
   has at least one project in it, close the current page and start a new
   one with that project. (A single project whose own line count exceeds
   `page_size` is still placed alone on a page and allowed to overflow —
   otherwise a 60-vendor project could never render. This should be a rare
   edge case at this app's scale.)
3. This produces the full `pages: string[][]` (project ids per page) for the
   current sort order and scope. The requested `page` just indexes into it;
   only that page's project ids get a full row + vendor-line fetch.

Consequences worth being upfront about:
- **Page sizes become variable.** "50 rows per page" is now a ceiling, not a
  guarantee — a page can render fewer rows when the next project didn't fit.
  This is the literal trade-off requested, not a bug.
- **`total_pages` must come from the server**, not from
  `Math.ceil(total / page_size)` on the frontend, since page boundaries are
  no longer evenly spaced. `projectListSchema` gains `total_pages` (see
  Phase 1); `ProjectTable`'s pager reads it directly instead of computing it.
- This packing pass is O(n) over the scoped project set after an O(n log n)
  sort — cheap at this app's documented scale (≤500 projects), and the same
  "fetch the small scoped set into memory" pattern the aging/priority sort
  branch already uses today.
- The packing only has a well-defined "project order" for **project-level**
  sort columns (name, customer, dates, stage, etc. — everything in
  `SORTABLE_COLUMNS` today, plus the default `created_at ASC`). Vendor-level
  columns (price, aging, vendor name, …) don't have one value per project to
  sort pages by — see Phase 5 for how those are handled (sorted within the
  page, client-side, once a page's lines are loaded).

**3.2 — Confirmed: nested array, frontend flattens.** `GET /api/projects`
returns each project with an embedded `vendors: ProjectVendorLine[]`; the
frontend builds the display rows (§Phase 5).

**3.3 — Confirmed: vendor-based charts count lines, and drill-down now shows
project + vendor.** For the `vendor_type` and `priority` dashboard columns,
`getChartData` groups over `project_vendors` rows (a 3-vendor project
contributes 3 line entries), and `getDrillDown` returns one entry per
matching **line**, not per project — so clicking a slice can list the same
project more than once, each time next to the specific vendor that put it in
that bucket. `drillDownSchema`'s `projects` array gains an optional
`vendor_name: z.string().nullable()`, populated only for `vendor_type`/
`priority` (all other columns stay project-level, `vendor_name: null`).
`DrillDownPanel.tsx` renders `"{project_name} — {vendor_name}"` when
`vendor_name` is present, else just the project name as today.

**3.4 — Confirmed: real delete, not soft-deactivate.** Unlike
`market_segments` (referenced by label, hence soft-deleted), customers and
vendors are referenced by id, and hard-deleting one is allowed from Settings
even if it's already used on projects. Concretely:
- `customers`/`vendors` get **no `is_active` column** — just `id` + `name`.
- Deleting one is a real `DELETE`. Existing `projects.customer_id` /
  `project_vendors.vendor_id` references to a deleted row become orphaned
  (same "orphan rather than silently break" trade-off already accepted
  elsewhere in this codebase for replaced Drive documents) — the list
  queries `LEFT JOIN` customers/vendors, so an orphaned reference resolves to
  `NULL` and the UI shows **"(deleted customer)"** / **"(deleted vendor)"**
  instead of the usual blank `—`, so it's visibly distinct from "never set."
- The Settings page's delete button shows a confirmation naming how many
  projects/vendor-lines currently reference the entity, so a SUPER_ADMIN
  isn't surprised by the orphaning.

**3.5 — Confirmed: both roles can add; only SUPER_ADMIN can rename or
delete.** `POST /api/customers` / `POST /api/vendors` are `requireAuth` only
(STAFF can add a new one inline from the combobox while building a project);
`PATCH`/`DELETE` on either are `requireAuth, requireRole('SUPER_ADMIN')`,
managed from the Settings page next to Market Segments. Duplicate names
aren't blocked at the DB level — the combobox's type-ahead is the guard
against accidental dupes, not a unique constraint.

**3.6 — Confirmed: export all three to parquet**, alongside `projects`.

## 4. Migration of existing data

`projects.customer_name` / `vendor_name` are free text today, so the
one-time migration has to dedupe strings into rows:

- For each distinct non-null `customer_name`, insert one `customers` row;
  build a `name → id` map.
- For each distinct non-null `vendor_name`, insert one `vendors` row; build a
  `name → id` map.
- For each existing `projects` row: set `customer_id` from the map (skip if
  `customer_name` was null); if `vendor_name` was non-null, insert **one**
  `project_vendors` row carrying over `vendor_id` plus all the vendor-section
  columns from that project row (`sort_order = 0`, so it becomes "Vendor 1").
  If `vendor_name` was null, the project simply starts with zero vendor
  lines.
- Drop the now-migrated columns from `projects` (`customer_name`,
  `vendor_name`, `vendor_revenue`, `vendor_type`, `project_sent_date`,
  `project_finish_date`, `vendor_project_id`, `negotiation_date`,
  `approval_date`, `document_sent_date`, `document_id`, `vendor_price`,
  `vendor_start_contract`, `vendor_end_contract`) — same idempotent
  add-column-if-missing / drop-column-if-present pattern already used in
  `migrate.ts` for `dropUploadedDocColumns`.

This step is destructive-by-column (not by row) and irreversible once the
old columns are dropped, so it runs inside one `runWrite` transaction, and —
matching your existing "backup/recreate/restore" convention — the plan below
takes a copy of `app.duckdb` before Phase 1 runs against a real dataset.

## 5. Phased implementation

### Phase 1 — Shared schema & types (`packages/shared`)

New files:
- `packages/shared/src/schemas/customer.ts` — `customerSchema`,
  `customerCreateSchema` (`{ name }`), exports `Customer`, `CustomerCreate`.
- `packages/shared/src/schemas/vendor.ts` — mirrors `customer.ts`.
- `packages/shared/src/schemas/projectVendor.ts` —
  ```ts
  export const projectVendorSchema = z.object({
    id: z.string().uuid(),
    project_id: z.string().uuid(),
    vendor_id: z.string().uuid(),
    vendor_name: z.string(),          // joined in, read-only
    vendor_type: z.enum(GOODS_OR_SERVICE).nullable().optional(),
    vendor_revenue: z.number().int().nullable().optional(),
    project_sent_date: z.string().nullable().optional(),
    project_finish_date: z.string().nullable().optional(),
    vendor_project_id: z.string().nullable().optional(),
    negotiation_date: z.string().nullable().optional(),
    approval_date: z.string().nullable().optional(),
    document_sent_date: z.string().nullable().optional(),
    document_id: z.string().nullable().optional(),
    vendor_price: z.number().int().nullable().optional(),
    vendor_start_contract: z.string().nullable().optional(),
    vendor_end_contract: z.string().nullable().optional(),
    sort_order: z.number().int(),
    // derived, never submitted — computed the same way Project.priority is today
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  });
  export const projectVendorCreateSchema = projectVendorSchema.omit({
    id: true, project_id: true, vendor_name: true, priority: true,
  });
  export const projectVendorUpdateSchema = projectVendorCreateSchema.partial();
  ```
- `packages/shared/src/schemas/project.ts` — remove all vendor-section fields
  and `customer_name`; add `customer_id: z.string().uuid().nullable().optional()`
  and `customer_name: z.string().nullable().optional()` (joined in, read-only,
  same pattern as today's `staff_assigned_name`/`pic_name`); add
  `vendors: z.array(projectVendorSchema).optional()` for the embedded list
  from §3.2.
- `packages/shared/src/schemas/project.ts` (`projectListSchema`) — add
  `total_pages: z.number().int()` and `total_lines: z.number().int()`
  alongside the existing `total` (kept as the project count). The pager
  must read `total_pages` directly rather than deriving it from `total` /
  `page_size`, since page sizes are no longer uniform (§3.1).
- `packages/shared/src/schemas/dashboardView.ts` (`drillDownSchema`) — each
  entry in `projects` gains `vendor_name: z.string().nullable().optional()`
  (§3.3).
- `packages/shared/src/index.ts` — export the three new schema files.

Gate: `npm run typecheck -w @tracker/shared`.

### Phase 2 — DB schema & migration (`apps/server/src/db`)

- `migrate.ts`: add `customers`/`vendors`/`project_vendors` `CREATE TABLE IF
  NOT EXISTS` blocks to `DDL`. Add a new idempotent step,
  `migrateCustomersAndVendors()`, implementing §4 — guarded the same way
  `migrateColumns()` guards its one-time PIC rename (check whether
  `projects.customer_name` still exists; if so, run the migration and drop
  the old columns; if not, no-op). Call it from `migrate()` after
  `migrateColumns()`.
- `export.ts`: extend the `exportSnapshots` table union with `'customers' |
  'vendors' | 'project_vendors'` and their `COPY ... TO parquet` statements
  (per 3.6).
- Update `_rbac_setup.ts`, `seed.ts`, `seed-dummy.ts` to stop inserting
  `customer_name`/vendor-section columns directly into `projects`, and
  instead create/find a customer + vendor row and a `project_vendors` row.
  This is mechanical but touches every hardcoded project-insert in the three
  scripts.

Gate: fresh `npm run dev:server` boot against a **copied** `app.duckdb`,
confirm row counts (`SELECT count(*) FROM customers/vendors/project_vendors`)
match the distinct-name counts from the old `projects` table before
proceeding.

### Phase 3 — Backend services & routes

New modules, mirroring the existing `settings/` module shape:
- `apps/server/src/modules/customers/{customersService,routes}.ts`
  - `listCustomers(q?: string)` — `WHERE name ILIKE '%'||?||'%' ORDER BY name
    LIMIT 20` when `q` is present (type-ahead), else the full list (for a
    plain dropdown / prefetch).
  - `createCustomer({ name })` — insert, return `{ id, name }`.
  - `renameCustomer(id, { name })` — SUPER_ADMIN only (per 3.5).
  - `deleteCustomer(id)` — SUPER_ADMIN only; real `DELETE FROM customers
    WHERE id = ?` (per 3.4, no `is_active` gate). Before deleting, look up
    `SELECT count(*) FROM projects WHERE customer_id = ?` so the route can
    return that count for the confirmation UI.
  - Routes: `GET /api/customers?q=`, `POST /api/customers` (`requireAuth`
    only), `PATCH /api/customers/:id` and `DELETE /api/customers/:id`
    (`requireAuth, requireRole('SUPER_ADMIN')`).
- `apps/server/src/modules/vendors/{vendorsService,routes}.ts` — identical
  shape for vendors, counting `project_vendors` rows instead of `projects`
  for the pre-delete usage count.
- `apps/server/src/modules/project-vendors/{projectVendorsService,routes}.ts`
  - `listForProject(projectId)`, `addVendorLine(projectId, payload)`,
    `updateVendorLine(id, payload)`, `removeVendorLine(id)` — ownership check
    reuses `assertStaffOwnership` against the **parent project's**
    `staff_assigned_id` (a STAFF member edits vendor lines only on projects
    they own, same rule as today).
  - Routes nested under the existing projects router:
    `GET/POST /api/projects/:projectId/vendors`,
    `PATCH/DELETE /api/projects/:projectId/vendors/:id`.
- `apps/server/src/app.ts` — mount the three new routers.
- `apps/server/src/modules/projects/projectsService.ts`:
  - `PROJECT_COLUMNS` loses the vendor-section fields, gains `customer_id`.
  - `listProjects` is restructured around the §3.1 packing algorithm:
    1. `SELECT p.id, <sort columns needed>, COUNT(pv.id) AS line_count FROM
       projects p LEFT JOIN project_vendors pv ON pv.project_id = p.id
       {scopeClause} GROUP BY p.id ORDER BY {sortExpr}` — one lightweight
       query for the whole scoped set (id + count + sort key only).
    2. `packIntoPages(rows, pageSize)` — a small pure function implementing
       the greedy walk from §3.1, returning `string[][]` (project ids per
       page). `total_pages = pages.length`; `total = <scoped project
       count>`; `total_lines = sum(line_count)`.
    3. For the requested `page`, fetch full rows for `pages[page - 1]`'s ids
       (`SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS
       pic_name, c.name AS customer_name FROM projects p LEFT JOIN ...
       LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id IN (...)`,
       ordered to match the pack's project order), then
       `SELECT * FROM project_vendors WHERE project_id IN (...) ORDER BY
       sort_order` (same batching pattern as `getLatestUpdateInfo`), grouped
       by `project_id` and attached as each project's `vendors`, computing
       each line's `priority` via `computePriority(computeAging(line),
       thresholds)`.
    4. Derived-sort project ordering (when `sort_by` is `aging`/`priority`)
       uses each project's **first vendor line** (`sort_order = 0`) as the
       representative value for step 1's `ORDER BY`, computed in memory
       exactly like `compareDerived` does today — this only orders which
       page a project lands on; the actual per-line values still render
       correctly for every line via step 3.
  - `createProject`/`updateProject`: `assertStaffOwnership` unchanged;
    `createProject` accepts an optional `vendors: ProjectVendorCreate[]`
    array and inserts the project + its vendor lines in one `runWrite`
    transaction, so the "Add project" form still works in a single submit.
    Vendor lines can also be added/edited/removed afterwards through the new
    `project-vendors` endpoints.
- `apps/server/src/modules/dashboard/dashboardService.ts`:
  - `getChartData` for `vendor_type` and `priority` groups over
    `project_vendors` (joined to `projects` for `scopeClause`'s
    `staff_assigned_id` filter) instead of `projects` directly — each vendor
    line is one unit in the count, per 3.3.
  - `getDrillDown` for those two columns returns one entry per **matching
    line**, including that line's `vendor_name`, so the same project can
    appear more than once in the panel (once per vendor pushing it into that
    bucket). Every other column keeps returning one entry per project with
    `vendor_name: null`.

Gate: `npm run typecheck -w @tracker/server`; manual smoke test of each new
endpoint via the dev server before frontend work starts.

### Phase 4 — Frontend: combobox + vendor-lines editor

- New shared component `apps/web/src/components/EntityCombobox.tsx`:
  type-ahead input backed by `GET /api/{customers|vendors}?q=`, debounced
  (~250ms), renders matches plus an `Add "<query>"` row when no exact
  case-insensitive match exists; selecting "Add" calls the create endpoint
  and immediately selects the new row. Generic over `{ id, name }` so one
  component serves both entities.
- `apps/web/src/hooks/useCustomers.ts` / `useVendors.ts` — thin TanStack
  Query wrappers (`useEntitySearch(q)`, `useCreateEntity()`), mirroring
  `useSettings.ts`'s market-segment hooks.
- `apps/web/src/hooks/useProjectVendors.ts` — `useAddVendorLine`,
  `useUpdateVendorLine`, `useRemoveVendorLine`, invalidating `['projects']`
  on success (vendor lines are embedded in the project list response).
- `EditProjectModal.tsx`:
  - Customer field: replace the plain text input with `EntityCombobox`
    bound to `customer_id`/`customer_name`.
  - Vendor section: replace the single flat set of vendor fields with a
    repeatable "Vendor lines" list — each line renders the same fields
    (`EntityCombobox` for vendor + the existing date/number inputs) with a
    remove button, plus an "Add vendor" button appending a blank line. Saves
    diff against the original `vendors` array: new lines → POST, changed
    lines → PATCH, removed lines → DELETE, fired in parallel before closing
    the modal.
- `GridPage.tsx`'s inline "Add project" form: customer field becomes an
  `EntityCombobox`; the vendor sub-section becomes optional and repeatable
  the same way (can start with zero vendor lines and add them later from the
  row modal, since `createProject` now accepts `vendors: []`).
- Orphaned-reference display (§3.4): everywhere `customer_name`/`vendor_name`
  is rendered (grid cells, the modal's read-only badges, drill-down panel),
  render **"(deleted customer)"**/**"(deleted vendor)"** — distinct from the
  usual `—` — when the id is set but the joined name came back `null`.
- `SettingsPage.tsx`: add a "Customers" and a "Vendors" panel, modeled on the
  existing `MarketSegmentsPanel`, but with a **Delete** button (with the
  usage-count confirmation from Phase 3) instead of
  Deactivate/Reactivate — there's no `is_active` toggle for these two.

Gate: `npm run typecheck -w @tracker/web`; manual pass creating a project
with 0, 1, and 2 vendor lines, and adding a brand-new customer/vendor
mid-flow.

### Phase 5 — Grid: multi-vendor row display

This is the part that changes `ProjectTable.tsx`/`columns.tsx` the most.

- Flattening: given `rows: Project[]` (each with an embedded `vendors[]`),
  build a `displayRows` array before handing data to `useReactTable`:
  ```ts
  type DisplayRow = { project: Project; vendor: ProjectVendorLine | null; isFirstOfGroup: boolean };
  function flatten(rows: Project[]): DisplayRow[] {
    return rows.flatMap((p) =>
      p.vendors.length === 0
        ? [{ project: p, vendor: null, isFirstOfGroup: true }]
        : p.vendors
            .slice() // sort_order ASC, already ordered by the API
            .map((v, i) => ({ project: p, vendor: v, isFirstOfGroup: i === 0 })),
    );
  }
  ```
- `columns.tsx`: the "Project Info" and "Customer" column groups render
  their `cell` from `row.project` but return blank (`—`/empty, matching the
  existing muted-dash style) when `!row.isFirstOfGroup` — this is the visual
  the mock in §0 asks for, without needing real CSS row-spanning (which
  would fight the current virtualization + sticky-column setup, per the
  existing "plain `<div>` + ARIA roles" learning already on file for this
  grid). The "Vendor Section" columns render from `row.vendor` (blank `—`
  when `row.vendor === null`).
- Aging/Priority columns compute from `row.vendor` (`computeAging(row.vendor
  ?? {})` → `null` when there's no vendor line yet, same as today's "no sent
  date" blank state).
- Sorting: `handleSortClick` continues to call the same
  `onSortChange(columnId, dir)`; for vendor-section/aging/priority columns
  this is a **client-side sort of the current page's flattened rows** rather
  than a server `ORDER BY` — a vendor-level value doesn't have one
  per-project row to sort pages by (§3.1, step 4 only orders by the
  *first* line for page placement, not by every line). Project-level columns
  (`project_name`, `customer_name`, `current_stage`, etc.) keep sorting
  server-side, driving the pack in §3.1, as they do today.
- Pager: `total_pages` comes straight from the API response (§Phase 1) —
  `Math.ceil(total / pageSize)` is removed from `ProjectTable.tsx`. The
  "N project(s)" footer label becomes "N project(s) · M vendor line(s)"
  using the new `total`/`total_lines` fields.
- Row click / edit affordances: the pencil / row-click-to-open-modal
  continues to target `row.project` (editing always opens the full project +
  its vendor lines together), regardless of which vendor line was clicked.
- `EditProjectModal`'s "Priority" badge (`ReadOnlyBadges`) becomes a list of
  badges (one per vendor line) instead of a single badge, since priority is
  now per-line.

Gate: Playwright — extend `priority.spec.ts` to add a second vendor line to a
project and assert two Aging/Priority badges/rows; add a new
`multi-vendor.spec.ts` covering the blank-second-row visual (assert the
project-name cell text is empty on the second vendor's row), the add/remove
vendor line flow in the modal, and a pagination-boundary case (a project with
enough vendor lines that it wouldn't fit in the remaining space of a page —
assert it starts fresh on the next page rather than splitting, and that the
page it deferred from renders fewer than `page_size` rows).

### Phase 6 — Test & fixture updates

- `_rbac_setup.ts`, `dashboard.spec.ts`, `dashboard-drilldown.spec.ts`,
  `edit-modal.spec.ts`, `grid.spec.ts`, `priority.spec.ts`,
  `update-progress.spec.ts`: every spec that fills `Customer name`/`Vendor`
  as a plain text input, or asserts on `project_sent_date` as a direct
  project field, needs updating to the combobox interaction and to target a
  vendor line's fields instead of the project's. This is mechanical but
  touches most of the existing E2E suite — budget this as its own pass
  rather than folding it into Phase 5's gate.
- `drive-integration.spec.ts`, `notifications.spec.ts` are unaffected (no
  customer/vendor field interaction).

## 6. Suggested order of work

1. §3's six decisions are resolved above.
2. Phase 1 (shared types) → Phase 2 (schema + migration, tested against a
   **copy** of the DB) → Phase 3 (backend) — these three can be reviewed and
   merged before any UI changes, since nothing in the UI breaks until
   `projectSchema` actually changes shape.
3. Phase 4 (combobox + vendor-lines editor) — the app is usable again at the
   end of this phase, just without the fancy blank-row grid grouping (every
   vendor line would render as its own fully-repeated project row as a
   temporary fallback if you want to ship in between).
4. Phase 5 (grid grouping) — purely visual/sorting, no data model changes.
5. Phase 6 (test suite catch-up) — can start in parallel with Phase 5 once
   Phase 4 lands, since most of the mechanical spec updates don't depend on
   the grouping visual.
