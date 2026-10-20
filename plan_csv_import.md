# Plan: CSV Import with Column Mapping

Import projects (and their vendor lines) from a CSV into the app. The user picks a file, then a **mapping window** asks which CSV column goes to which platform field. The window uses natural-language labels with descriptions. The backend only ever sees internal field keys such as `project_sent_date`.

---

## 1. Goals and non-goals

**Goals**
- SUPER_ADMIN uploads a CSV and chooses how each CSV column maps to a platform field.
- The mapping window reads: **"Tanggal Kirim FPT" (from the CSV) will be mapped to FPT Sent Date (in the platform)**, plus a short description of the chosen field.
- Works with the current grid-style CSV (blank project/customer cells on continuation vendor rows) and with fully filled-in rows.
- Preview and validation before anything is written. Commit is all-or-nothing.
- Renaming a label or description later is a one-line edit. Internal keys never change.

**Non-goals (for now)**
- STAFF imports.
- Updating existing projects from CSV (v1 skips or rejects duplicates).
- Creating Google Drive folders during import.
- Importing `issues`, `update_progress`, history, aging, priority, status badges or the `#` column. These are derived, display-only, or written through their own endpoints.

---

## 2. Core idea: one field registry

Create **one registry in `@tracker/shared`** that describes every importable field. The mapping window, template download, header auto-suggest, validation and server whitelist all read from it. Nothing else holds labels for import.

File: `packages/shared/src/lib/importFields.ts` (export it from `index.ts`).

```ts
export type ImportFieldType = 'text' | 'number' | 'date' | 'enum' | 'lookup';
export type ImportFieldLevel = 'project' | 'vendor';

export interface ImportField {
  key: string;                 // internal key sent to the server. NEVER rename.
  label: string;               // natural-language name shown in the modal. Free to edit.
  description: string;         // one or two sentences shown under the dropdown. Free to edit.
  section: 'Project info' | 'Customer' | 'Vendor line';
  level: ImportFieldLevel;     // 'project' = read once per project, 'vendor' = one per row
  type: ImportFieldType;
  required?: boolean;
  aliases: string[];           // alternative CSV header spellings for auto-suggest
  example?: string;            // shown in the template and as a hint
  enumValues?: readonly string[];
}

export const IMPORT_FIELDS: ImportField[] = [ /* see section 3 */ ];
export const IMPORT_FIELD_KEYS = new Set(IMPORT_FIELDS.map((f) => f.key));
```

**Rename rule:** the `label`, `description` and `aliases` can change at any time. The `key` is the contract with the database and the zod schemas and stays as is.

---

## 3. Fields (proposed labels and descriptions)

These are proposals. Edit the wording freely, but keep the keys.

### Project info
| key | label | description | notes |
|---|---|---|---|
| `project_name` | Project Name | Name of the project. Rows with the same project name (or folder reference) are grouped into one project. | **required** |
| `folder_name` | Folder Reference | Internal folder/reference code for the project, e.g. 2026-001. Used first to group rows into one project. | |
| `staff_assigned` | Sales Name | Sales person responsible. Match by the user's email or exact name. | lookup, writes `staff_assigned_id` |
| `pic` | Responsible PIC | Person in charge of the project. Match by email or exact name. | lookup, writes `pic_id` |
| `current_stage` | Status | "On Progress" or "Finish". Blank means On Progress. | enum |

### Customer
| key | label | description | notes |
|---|---|---|---|
| `customer_name` | Customer | Customer name. Matched ignoring case. If it doesn't exist yet it is created. | lookup, writes `customer_id` |
| `market_segment` | Market Segment | Free-text segment, e.g. Government, Enterprise. | |
| `service_or_goods` | Project Type | "service" or "goods". | enum |
| `date_customer_received_doc1` | Customer SP Received Date | Date the customer's SP (order letter) was received. | date |
| `date_customer_received_doc2` | Customer PO/PKS Received Date | Date the customer's PO/PKS was received. | date |
| `doc2_number_id` | Customer PO/PKS Number | PO/PKS number from the customer. | |
| `customer_price` | Customer PO/PKS Amount | Contract value from the customer, in Rupiah, whole numbers. | number |
| `customer_start_contract` | Customer Contract Start | Start date of the customer contract. | date |
| `customer_end_contract` | Customer Contract End | End date of the customer contract. Used for the deadline warning. | date |

### Vendor line (one per CSV row)
| key | label | description | notes |
|---|---|---|---|
| `vendor_name` | Vendor | Vendor for this line. Matched ignoring case. Created if missing. A row with no vendor creates no vendor line. | lookup, writes `vendor_id` |
| `vendor_type` | Vendor Project Type | "service" or "goods" for this vendor line. | enum |
| `vendor_revenue` | RAB Amount | Budget amount (RAB) for this vendor line, in Rupiah. | number |
| `project_sent_date` | FPT Sent Date | Date the FPT was sent to the vendor. **Aging starts counting from this date**, and Priority is derived from it. | date |
| `project_finish_date` | FPT Finish Date | Date the FPT was finished. | date |
| `vendor_project_id` | FPT Number | FPT number for this vendor line. | |
| `negotiation_date` | Vendor Negotiation Date | Date negotiation with the vendor took place. | date |
| `approval_date` | Vendor SP Received Date | Date the vendor's SP was received. **Stops the Aging count** for this line. | date |
| `document_sent_date` | PO/PKS Sent to Vendor Date | Date the PO/PKS was sent to the vendor. | date |
| `document_id` | Vendor PO/PKS Number | PO/PKS number issued to the vendor. | |
| `vendor_price` | Vendor PO/PKS Amount | PO/PKS value for the vendor, in Rupiah. | number |
| `vendor_start_contract` | Vendor Contract Start | Start date of the vendor contract. | date |
| `vendor_end_contract` | Vendor Contract End | End date of the vendor contract. | date |

**Label consistency fix:** today the grid, the edit modal and the dashboard each name some of these differently (for example `project_sent_date` is "Finish FPT Date" in the grid but "Tanggal Kirim FPT" in the modal). Once the registry exists, consider making `columns.tsx` and `FIELD_LABELS` read from it so every screen agrees. This is optional and can be a separate task.

**Aliases:** for each field include the internal key, the current grid header, the current modal label, and any Indonesian variants (e.g. `project_sent_date` -> `["project_sent_date", "Finish FPT Date", "Tanggal Kirim FPT", "FPT Sent Date"]`). Auto-suggest uses them.

---

## 4. User flow (the wizard)

New button **Import CSV** on the Grid page next to "Add project" (SUPER_ADMIN only). It opens a modal with four steps.

### Step 1: Choose file
- File picker (`.csv`). The browser parses it with `papaparse` (new web dependency). Nothing is sent to the server yet.
- Detect delimiter automatically (comma, semicolon, tab). Excel in Indonesian locale often exports `;`.
- Show: file name, row count, detected delimiter.
- Link: **Download CSV template** (generated from the registry, one example row, every row filled in).

### Step 2: Map columns (the part you asked for)
One row per **CSV column**. Layout per row:

```
 "Tanggal Kirim FPT"          sample: 2026-08-01, 2026-08-04, 2026-08-09
 (from the CSV) will be mapped to
 [ FPT Sent Date               v ]   (in the platform)
 Date the FPT was sent to the vendor. Aging starts counting from this date.
```

Behaviour:
- The dropdown lists **labels**, grouped by section (Project info / Customer / Vendor line), each option with its description as a subtitle, plus **Ignore this column** at the top. The user never sees `project_sent_date`.
- Selecting a field shows its description and type hint (date, whole number, etc.) under the dropdown, plus up to 3 sample values from that column.
- **Auto-suggest** on open, in this order: (1) the user's saved mapping, (2) exact match on normalized label/alias (lowercase, trim, strip punctuation and extra spaces), (3) close match. Unmatched columns default to Ignore. Auto-suggested rows get a small "suggested" tag so the user knows to check them.
- A platform field can only be chosen once. Already-used fields are greyed out in other dropdowns, with a tooltip naming the column using it.
- **Required check:** a banner stays visible until `project_name` is mapped. If no `vendor_name` is mapped, show an info note: "No vendor column mapped: projects will be created without vendor lines."
- **Options** at the bottom of the step:
  - Checkbox **"Blank project cells continue the row above"** (auto-ticked when blank project names are detected; this is the grid-style CSV).
  - **Date format** dropdown: `YYYY-MM-DD`, `DD/MM/YYYY` (default), `MM/DD/YYYY`, `D Month YYYY`.
  - **If a project already exists:** Skip it (default) / Reject the whole import.
- Buttons: Back, **Next: Preview**. "Save this mapping for next time" checkbox, ticked by default.

### Step 3: Preview and validate
- Calls the server preview endpoint. Nothing is written.
- Summary: projects to create, vendor lines to create, new customers, new vendors, rows skipped as duplicates, rows with errors.
- Table of the first 50 projects with their vendor lines nested. Errors listed per row as `Row 14: FPT Sent Date "31/02/2026" is not a valid date`. Messages use **labels**, not keys.
- If there are errors, the user can go Back to fix the mapping or the date format, or fix the CSV and re-upload. **Commit is disabled while any row has an error.**

### Step 4: Confirm and result
- **Import N projects** button. Result screen: created counts, skipped duplicates, and a toast. Grid refetches (`['projects']`, `['entities']`, `['project-years']` query keys invalidated).

---

## 5. What the browser sends to the server

The client sends **internal keys only**, never CSV header names:

```jsonc
POST /api/import/projects/preview   (and /commit with the same body)
{
  "options": { "continueBlankRows": true, "dateFormat": "DD/MM/YYYY", "onDuplicate": "skip" },
  "mapping": { "Tanggal Kirim FPT": "project_sent_date", "Customer": "customer_name", "#": null },
  "rows": [ { "Tanggal Kirim FPT": "01/08/2026", "Customer": "Stedin", "#": "1" } ]
}
```

Alternatively the client can apply the mapping first and send `rows: [{ project_sent_date: "...", customer_name: "..." }]`. **Preferred:** apply the mapping on the client so the server receives rows that already use internal keys. Either way the server must **whitelist every key against `IMPORT_FIELD_KEYS`** and reject unknown keys with 400.

Notes:
- `express.json()` defaults to a 100 kb body limit. Mount the import router with its own parser, e.g. `express.json({ limit: '10mb' })`, and cap rows (e.g. 5,000).
- Preview and commit both run the same validation function. Commit never trusts a prior preview; it re-validates.

---

## 6. Server module

New folder `apps/server/src/modules/import/`:
- `routes.ts`: `requireAuth`, `requireRole('SUPER_ADMIN')`, then `POST /projects/preview` and `POST /projects/commit`. Mounted at `/api/import` in `app.ts`.
- `importService.ts`: `previewProjectImport(body)` and `commitProjectImport(user, body)`.
- `parsers.ts`: date, number, enum and lookup cell parsers (pure functions, unit-testable).

### Processing pipeline
1. **Validate request** with a zod schema (options, mapping, rows, limits). Unknown keys -> 400.
2. **Continuation fill:** if `continueBlankRows`, a row with blank `project_name` copies all project-level and customer-level values from the previous row. A first row with a blank project name is an error.
3. **Group into projects:** group key is `folder_name` if present, otherwise `project_name` (case-insensitive, trimmed). Project-level values come from the first row of the group. If a later row of the same group has a **different non-blank** value for a project-level field, report a conflict naming both rows. Never silently pick one.
4. **Parse cells:** convert each value to its type (rules below). Collect errors with `{ row, fieldKey, message }`.
5. **Resolve lookups:**
   - Customers and vendors: case-insensitive name match. Missing ones are queued for creation (one per distinct name; do not create duplicates within the same import).
   - Sales / PIC: match by email, then exact name, among **active** users. Not found is an error (users are never created by import). Sales must be a user eligible per existing rules; PIC any active user.
6. **Validate with existing schemas:** build `ProjectCreate` and `ProjectVendorCreate` objects and run `projectCreateSchema` / `projectVendorCreateSchema` so import obeys the same rules as the Add Project form.
7. **Duplicates:** a project "exists" if an existing project has the same `folder_name` (when provided) or, otherwise, the same `project_name` (case-insensitive). Behaviour per `onDuplicate`: `skip` (listed in the result) or `reject` (error).
8. **Preview returns** counts, nested sample, and errors, using **labels** from the registry in messages.
9. **Commit** repeats steps 1-8, aborts with 400 if any error remains, then writes.

### Commit transaction (important)
`runWrite` only holds the mutex. It does **not** open a database transaction by itself. For all-or-nothing, wrap explicitly:

```ts
await runWrite(async (ex) => {
  await ex('BEGIN');
  try {
    // insert customers, vendors, projects, project_vendors using `ex` directly
    await ex('COMMIT');
  } catch (err) {
    await ex('ROLLBACK');
    throw err;
  }
});
await exportSnapshots(['projects', 'project_vendors', 'customers', 'vendors']); // AFTER the block
```

Rules to follow:
- Insert customers/vendors inline with `ex` inside the same block. **Do not** call `createCustomer` / `createVendor` / `createProject` from inside it: they call `runWrite` themselves and would deadlock on the mutex.
- Call `exportSnapshots` **after** the `runWrite` block (it takes the mutex itself).
- Reuse the column lists and `insertProjectSql()` / `insertVendorLineSql()` helpers from `projectsService.ts` (export them) so import and create can't diverge.
- Insert only (no UPDATE), which sidesteps DuckDB's UPDATE limitations noted in the project learnings.
- Do **not** call `createProjectFolder`. Imported projects get `drive_folder_id = NULL`; admins link folders afterwards. (Avoids one Drive API call per row and partial failures.)
- STAFF-assignment rules don't apply because only SUPER_ADMIN imports. `current_stage` may be set directly.

### Cell parsing rules
- **Blank / whitespace / `-` / `—`** -> `null`.
- **Numbers (whole Rupiah):** strip `Rp`, spaces, and thousands separators (`.` or `,`). `1.234.567`, `1,234,567`, `Rp 1,234,567` all -> `1234567`. If a decimal part is detected (`,50` or `.5` at the end) show a **warning** and round, since the columns are integers.
- **Integer limit:** `customer_price`, `vendor_price` and `vendor_revenue` are DuckDB `INTEGER` (max 2,147,483,647). Values above that fail the insert. The seed data already reaches about 2.05 billion. Validation must report: "Amount is above the maximum the database can store (2,147,483,647)". If larger contracts are expected, plan a separate migration to `BIGINT` (and `z.number().int()` stays fine in zod, but check DuckDB-to-JS bigint handling in `connection.ts` results).
- **Dates:** parse according to the chosen format, plus always accept `YYYY-MM-DD`, ISO timestamps (cut to date) and the grid's long format (`15 September 2026`). Reject impossible dates (31 Feb). Output `YYYY-MM-DD`.
- **Enums:** case-insensitive; accept the internal value and the visible label (`On Progress` -> `on_progress`, `Finish` -> `finish`). Anything else is an error listing the allowed values.
- **Text:** trim, collapse nothing else.

---

## 7. Saved mapping (per user)

- Store in the existing `user_preferences` table with `pref_key = 'import_mapping_projects'` and value `{ "<csv header>": "<field key or null>" }` plus `version: 1`.
- Add a zod schema next to `gridPreferences.ts` in `@tracker/shared`, and server routes `GET/PUT/DELETE /api/me/preferences/import-mapping` reusing the pattern in `preferencesService.ts` (DELETE-then-INSERT inside one `runWrite`; size cap).
- Like the other preferences, it is operational data and is **never exported to parquet**.
- On load, drop any saved key that is no longer in `IMPORT_FIELD_KEYS`, so removing a field never breaks old saved mappings.

---

## 8. Frontend files

- `apps/web/src/components/import/ImportCsvModal.tsx`: the four-step wizard (uses `Modal`, `Button`, `Select` from `components/ui`).
- `apps/web/src/components/import/ColumnMappingStep.tsx`: the mapping rows and the "from the CSV -> in the platform" sentence.
- `apps/web/src/components/import/FieldSelect.tsx`: grouped dropdown showing label + description (custom listbox, since a native `<select>` can't show subtitles).
- `apps/web/src/lib/csvImport.ts`: parse with papaparse, delimiter detection, header normalization, auto-suggest scoring, apply-mapping.
- `apps/web/src/hooks/useImport.ts`: `usePreviewImport`, `useCommitImport`, `useImportMapping` (react-query, same style as the other hooks).
- Edit `GridPage.tsx`: **Import CSV** button (admin only), mount the modal, refetch on success.
- Add `papaparse` and `@types/papaparse` to `apps/web/package.json`.

**Template download:** built in the browser from `IMPORT_FIELDS` (header row = labels, one example row from `example`), saved as `project-import-template.csv`. Use a UTF-8 BOM so Excel opens it correctly.

---

## 9. Build order

1. **Registry + parsers** in `@tracker/shared` (and `parsers.ts`) with unit tests for dates, numbers, enums.
2. **Server preview endpoint** (validation only, no writes). Test with curl or `smoke.ts`.
3. **Server commit endpoint** with the explicit transaction and exports.
4. **Saved-mapping preference** endpoints.
5. **Web: parse + mapping step** (the main UI). Verify the "X (from the CSV) will be mapped to Y (in the platform)" wording and descriptions.
6. **Web: preview, commit, result, template download.**
7. **Tests and docs** (below).

---

## 10. Testing

**`smoke.ts` additions**
- STAFF `POST /api/import/projects/preview` -> 403.
- Unknown field key in the payload -> 400.
- Preview with a valid grid-style payload (blank continuation rows) returns the right project and line counts and writes nothing.
- Commit creates the expected projects, vendor lines, customers, vendors; re-committing the same payload with `skip` creates nothing new.
- A payload with one bad date makes commit return 400 and **no rows exist afterwards** (rollback works).
- Amount above 2,147,483,647 is reported as a validation error rather than a 500.

**Playwright (`apps/web/e2e/csv-import.spec.ts`)**
- Admin uploads a fixture CSV with unusual headers; the mapping step shows the sentence with the CSV header and the **label**, not the internal key.
- Changing a mapping updates the description shown under the dropdown.
- Mapping the same field twice is prevented.
- `project_name` unmapped keeps **Next** disabled.
- Preview shows counts; commit creates the projects; they appear in the grid.
- Reopening the import with the same CSV shows the saved mapping pre-selected.
- STAFF doesn't see the Import CSV button.
- Name fixtures with the `0 E2E ...` prefix and clean up by API afterwards, like the other specs.

---

## 11. Open decisions (defaults used if you don't say otherwise)

| Decision | Default in this plan |
|---|---|
| Duplicate projects | Skip and report (option to reject) |
| Who can import | SUPER_ADMIN only |
| Match key for duplicates and grouping | `folder_name`, else `project_name` |
| Date format default | `DD/MM/YYYY` |
| Missing customers / vendors | Created automatically |
| Missing Sales / PIC user | Error (never auto-created) |
| Drive folders | Not created during import |
| Amounts above 2.1 billion | Rejected with a clear message (BIGINT migration is a separate task) |
| Existing label inconsistencies | Registry is separate; unifying grid/modal labels is optional |

---

## 12. How to rename things later

- **Change what users read** (label, description, example, aliases): edit that one entry in `IMPORT_FIELDS`. Mapping window, template, error messages and auto-suggest all follow.
- **Add a new importable field:** add the DB column/schema as usual, then add one registry entry and one line in the server's field-to-column mapping.
- **Never rename a `key`.** If a database column is ever renamed, change the key's server mapping and the saved-mapping cleanup (section 7) will drop stale saved entries automatically.
