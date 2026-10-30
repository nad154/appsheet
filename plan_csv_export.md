# Plan: Export current grid data as CSV

Feature for opencode2 (React + Express + DuckDB). Read `learnings-and-decisions.md` conventions first. No DB schema change and no migration are needed.

## 1. Goal

An **Export CSV** button on the Grid page downloads a `.csv` of the projects the user is currently looking at: same RBAC scope, same Year and Stage filters, same sort order. It exports **all pages** of the filtered set, not just the visible page.

The CSV uses the same field labels as the CSV import registry (`IMPORT_FIELDS`), so an exported file can be fed back into the Import wizard and its columns auto-map.

## 2. Decisions (already made, do not re-debate)

| Topic | Decision |
|---|---|
| Scope of rows | Whatever `listProjects` returns for the caller + current `year`, `stage`, `sort_by`, `sort_dir`, across all pages. STAFF stay limited to projects where they are Sales or PIC (enforced by `scopeClause` inside `listProjects`). |
| Who can export | Both roles. The button shows for SUPER_ADMIN and STAFF. (Import stays SUPER_ADMIN only.) |
| Row shape | **One CSV row per vendor line**. Project-level values are **repeated on every line row** (flat, filterable in Excel, and the import groups by folder or project name so it round-trips). A project with zero vendor lines gets one row with blank vendor columns. |
| Columns | All `IMPORT_FIELDS` in registry order, headers = `field.label`. Then four trailing info-only columns: `Aging (days)`, `Priority`, `Update Progress`, `Action`. Hidden or sticky grid columns are ignored in v1 (export is not tied to the Columns menu). |
| Dates | `YYYY-MM-DD` (import always accepts it, so it is independent of the import date-format option). |
| Numbers | Plain integers, no `Rp`, no thousands separators. Blank when null. |
| Enums | Registry labels, e.g. `On Progress`, `Finish`, `service`, `goods`. The import parser accepts these. |
| Lookups | Customer, vendor, Sales and PIC are exported by **name**. A deleted or missing referenced entity exports as blank (never `(deleted user)` text, because that would make the file un-importable). |
| Encoding | UTF-8 with BOM (`\uFEFF`) so Excel opens it correctly, CRLF line endings, RFC 4180 quoting (quote cells containing `,` `"` CR LF; double inner quotes). |
| CSV/formula injection | For **text** cells whose first character is `=`, `+`, `-`, `@`, tab or CR, prefix a single `'`. Never apply this to numeric or date cells. |
| Filename | `projects-YYYY-MM-DD.csv` (today's local date). |

## 3. Naming caution

`apps/server/src/db/export.ts` (`exportSnapshots`) is the **parquet** snapshot exporter and has nothing to do with this feature. Do not touch it. Name the new server module `modules/csv-export/` and use the word `csv` in every new identifier to avoid confusion.

## 4. Server

### 4.1 Pure serializer (new): `apps/server/src/modules/csv-export/csvExport.ts`

No I/O and no DB access, so it is unit-testable.

- `CSV_EXPORT_COLUMNS`: ordered list of `{ header, get(project, line) }`.
  - Built from `IMPORT_FIELDS`. Mapping of import key to source:
    - Project level: `project_name`, `folder_name`, `current_stage`, `market_segment`, `service_or_goods`, `date_customer_received_doc1`, `date_customer_received_doc2`, `doc2_number_id`, `customer_price`, `customer_start_contract`, `customer_end_contract` read the same-named project property. `customer_name` reads `project.customer_name`. `staff_assigned` reads `project.staff_assigned_name`. `pic` reads `project.pic_name`.
    - Vendor level: all other keys read the same-named property on the vendor line, and `vendor_name` reads `line.vendor_name`.
  - Type the getter map as `Record<string, Getter>` and add a unit test that every `IMPORT_FIELDS` key has a getter, so adding an import field later fails the test until export is updated.
  - Trailing columns: `Aging (days)` = `computeAging(line)` (blank if null), `Priority` = `line.priority` capitalised (`Low`/`Medium`/`High`, blank if null), `Update Progress` = `project.update_progress`, `Action` = `project.issues`.
- Value formatting by `field.type`:
  - `date`: accept a string or a `Date`; output the first 10 chars, or `toISOString().slice(0,10)` for a `Date` (DuckDB driver returns either, see `dateOnly()` in `issuesService.ts`).
  - `number`: `String(Number(v))`, blank for null/undefined/''.
  - `enum`: map internal value to `enumValues[i]` via `enumInternals`; unknown value passes through unchanged.
  - `text` and `lookup`: string, with the formula-injection prefix rule above.
- `flattenProjectsToRows(projects)`: for each project, one row per `project.vendors` entry, or a single row with `line = null` if none.
- `toCsv(headers, rows)`: returns the full string including BOM and CRLF.
- `buildProjectsCsv(projects)`: the composition of the three above.

### 4.2 Fetch all pages: `apps/server/src/modules/projects/projectsService.ts`

Add and export `listAllProjectsForExport(user, query)`:

- Calls the existing `listProjects(user, { ...query, page, page_size: 500 })` in a loop from page 1 up to `total_pages`, concatenating `rows`.
- Reusing `listProjects` guarantees identical RBAC scoping, filters, sort, joins, priority and update/issue metadata. Do not duplicate the SQL.
- Safety cap: stop after 100 pages.

### 4.3 Route: `apps/server/src/modules/projects/routes.ts`

`GET /api/projects/export.csv`

- **Must be registered before `GET /:id`** (the same place as `/years` and `/users`), otherwise `export.csv` is parsed as an id and returns 400.
- Behind the router's existing `requireAuth`; no extra role guard.
- Query params validated with the existing `listQuerySchema` minus `page` and `page_size`: `year`, `stage`, `sort_by`, `sort_dir`. Invalid input returns 400 (same `safeParse` pattern as the list route).
- Response headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="projects-YYYY-MM-DD.csv"`, `Cache-Control: no-store`.
- Body: `res.send(buildProjectsCsv(rows))`.
- Wrap in try/catch using the existing `handleError`.

## 5. Web

### 5.1 API client: `apps/web/src/lib/api-client.ts`

`apiClient.get` runs the body through `parseResponse` (JSON-or-text), which is wrong for a file, and the browser cannot send the bearer token through a plain `<a href>`. Add a `getBlob(path)` method:

- Reuses the same auth header and the **same 401 then refresh-once then retry** logic as `doRequest` (refactor minimally: add a `responseType: 'json' | 'blob'` parameter, or extract the shared fetch-with-refresh into a helper; do not copy the refresh code).
- Returns `{ blob, filename }`, where `filename` is parsed from `Content-Disposition`, falling back to `projects.csv`.
- Non-OK responses throw `ApiError` using the JSON `error` field, as today.

### 5.2 Download helper: `apps/web/src/lib/downloadBlob.ts` (new)

`downloadBlob(blob, filename)`: create an object URL, click a temporary `<a download>`, remove it, revoke the URL. Mirror the pattern in `downloadTemplateCsv` in `lib/csvImport.ts`.

### 5.3 Grid page: `apps/web/src/app/grid/GridPage.tsx`

- Add an **Export CSV** `Button variant="secondary"` in the `PageHeader` actions, before Import CSV. Visible to all roles. `data-testid="export-csv"`.
- On click: build a query string from the current `yearFilter`, `stageFilter`, `sortBy`, `sortDir` (omit undefined), call `apiClient.getBlob('/api/projects/export.csv?...')`, then `downloadBlob`.
- State `exporting`: disable the button and show `Exporting…` while in flight.
- Success: `showToast('CSV exported.', 'success')`. Failure: `showToast(err.message ?? 'Could not export CSV.', 'error')`.
- Do not reuse the `['projects']` query cache; the export is a one-off request and must not invalidate anything.

## 6. Tests

### 6.1 Unit (vitest) `apps/server/src/modules/csv-export/csvExport.test.ts`

- Escaping: comma, double quote, newline, and CRLF between rows.
- BOM is present exactly once at the start.
- Formula-injection prefix applies to text cells starting `= + - @` and is NOT applied to numbers or dates (a negative number stays `-5000`).
- Date handling for string, `Date` object and null.
- Enum label mapping (`on_progress` becomes `On Progress`).
- Numbers: plain digits, null becomes blank.
- Flattening: 0 lines gives 1 row; 3 lines gives 3 rows with project values repeated.
- Every `IMPORT_FIELDS` key has a getter; headers are unique and the first N headers equal the registry labels in order.

### 6.2 Smoke `apps/server/smoke.ts`

Add checks (follow the existing `check()` style, clean up what you create):

- Unauthenticated `GET /api/projects/export.csv` returns 401.
- Admin: 200, `content-type` contains `text/csv`, `content-disposition` contains `attachment`, body starts with the BOM, and the header row equals the expected header list.
- Data row count equals `total_lines` from `GET /api/projects` for the same filters (use the same `stage`/`year`).
- A created multi-vendor project appears as multiple rows with the repeated project name.
- `stage=finish` returns only finished projects.
- Staff: only rows for projects where they are Sales or PIC (compare project names against the staff list endpoint).
- **Round trip:** feed the exported admin CSV through the client-side parse/mapping logic is not available server-side, so instead assert the preview endpoint accepts a row object built from one exported row (header-to-key via the registry) with 0 errors.

### 6.3 E2E (Playwright) `apps/web/e2e/csv-export.spec.ts`

Follow the conventions of `multi-vendor.spec.ts`: API-created fixtures prefixed `0 E2E CSV Export`, `created_at` pinned old so they land on page 1, by-name cleanup before and after.

- Admin: create a project with two vendor lines via API, open the Grid, click `export-csv`, `page.waitForEvent('download')`, read the file. Assert the filename matches `/^projects-\d{4}-\d{2}-\d{2}\.csv$/`, the header contains `Project Name` and `FPT Sent Date`, and the fixture project name appears on two rows.
- Filter respected: set Stage to `Finished`, export, and assert the fixture (on progress) is absent.
- Staff: login as `staff1@example.com`, the button is visible, the downloaded file contains `Staff Project A` and does not contain `Admin Project A`.

## 7. Acceptance gates

1. `npm run typecheck` and `npm test` pass.
2. `smoke.ts` passes including the new checks.
3. New Playwright spec passes, and the existing specs still pass (the new route must not shadow `/:id`).
4. Manual: export, open in Excel, Indonesian names and long text display correctly (BOM works), dates are not corrupted, and re-importing the file in the Import wizard auto-maps all registry columns and previews with 0 errors (the project is reported as a duplicate and skipped, which is the expected result).

## 8. Out of scope (v1)

- Exporting only the visible/hidden Columns menu selection.
- XLSX output.
- Exporting update history or issue history.
- A background/async export job. Dataset size makes a synchronous response fine.
- Any change to parquet snapshot export.

## 9. Notes for the implementer

- Keep one consolidated `.csv` per click, no zip.
- Files to touch: new `csv-export/csvExport.ts` and its test, `projectsService.ts`, `projects/routes.ts`, `api-client.ts`, new `downloadBlob.ts`, `GridPage.tsx`, `smoke.ts`, new e2e spec.
- Do not add dependencies; hand-written CSV serialization is about 30 lines.
