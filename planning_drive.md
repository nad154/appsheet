# PLAN.md: Google Drive Integration Expansion (Folder Linking & Document Upload)

## Overview
Two features, scoped narrowly per role:

1. **Folder linking (SUPER_ADMIN only).** Link an existing Drive folder to a project, or auto-create a new one. This is a straight write to `projects.drive_folder_id` — no `pending_edits` path, no STAFF access at all.
2. **Document upload (SUPER_ADMIN + assigned STAFF).** A temporary single-slot "uploaded document" field on each project. Uploading replaces the current reference. Applies immediately for both roles — ownership-checked, not approval-gated. Disabled in the UI whenever the project has no linked Drive folder.

Both features reuse the app's existing conventions rather than introducing new ones: `runWrite()` for all mutations, Zod schemas in `packages/shared`, RBAC enforced server-side, `google/auth.ts` / `driveService.ts` as the single home for Drive access.

---

## Explicit Design Decisions (superseding the original draft)

- **Folder linking is SUPER_ADMIN-only, full stop.** No `pending_edits` involvement, no deferred-creation timing question — the folder is created/linked at the moment of the API call, same as today's `createProjectFolder` behavior at project-creation time.
- **`drive_folder_id` stays out of the generic edit surface.** It already isn't in `FIELD_TYPES`/`EDITABLE_FIELDS` (`projectFields.ts`), so it's not reachable via the row-edit modal or inline grid editing today. That stays true — the only way to change it is the new dedicated Link/Create-folder endpoints, both gated by `requireRole('SUPER_ADMIN')`.
- **Document upload is a separate field, separate endpoint, separate write path** — not routed through `submitUpdate`/`updateDirect`/`pending_edits` at all. It's excluded from `projectCreateSchema`/`projectUpdateSchema` (same pattern already used for `priority`: a field that exists on `Project` but can never be submitted through the generic PATCH).
- **Document upload ownership check mirrors `submitUpdate`'s existing check** (`project.staff_assigned_id !== user.id` → 403), but skips the pending-edit write and applies directly, per your instruction that only ownership matters here, not approval.
- **No Drive folder linked → upload control is fully disabled client-side.** The server still re-checks and rejects (400) regardless of what the client renders, per the "UI is a convenience, server enforces" convention already documented on `ProtectedRoute.tsx` and `rbac.ts`.
- **Naming collision avoided:** the project schema already has `document_id` (a business field — vendor PO/PKS number) and `document_sent_date`. The new fields are named `uploaded_doc_id` / `uploaded_doc_name` to avoid any ambiguity with those.
- **Upload uses `multer` memory storage with a 25MB cap**, not "true" zero-buffer streaming. Flagging this explicitly as a deliberate trade-off for a small LAN app rather than asserting a streaming guarantee the implementation won't actually provide. Revisit if larger files are needed later.
- **Replacing an uploaded document does not delete the old file from Drive** — it just overwrites the stored reference. The old file becomes orphaned in the project's Drive folder (visible if someone browses Drive directly, but not linked from the app anymore). Acceptable for a "temporary" field; can be revisited if it becomes a problem.

---

## Phase 1: Shared Package (`packages/shared`)

- [ ] **1.1 Extend `packages/shared/src/schemas/drive.ts`** (do not recreate — it already has `driveFolderInfoSchema` / `driveFileEntrySchema`):
  ```typescript
  export const linkDriveFolderSchema = z.object({
    folderInput: z.string().min(1, 'Folder ID or Google Drive URL is required'),
  });

  export const createDriveFolderSchema = z.object({
    folderName: z.string().min(1).optional(), // defaults to project_name if omitted
  });

  // Extend the existing entry schema with size (was missing):
  export const driveFileEntrySchema = z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    webViewLink: z.string().nullable(),
    size: z.string().optional(),
  });

  export const uploadedDocSchema = z.object({
    id: z.string().nullable(),
    name: z.string().nullable(),
  });
  export type UploadedDoc = z.infer<typeof uploadedDocSchema>;
  ```
  `projectId` is dropped from both request schemas — it belongs in the URL param (`/api/drive/:projectId/link`), not the body, matching the existing `resolveFolderUrl`/`listChildren` route shape.

- [ ] **1.2 Extend `packages/shared/src/schemas/project.ts`**
  - Add to `projectSchema`:
    ```typescript
    uploaded_doc_id: z.string().nullable().optional(),
    uploaded_doc_name: z.string().nullable().optional(),
    ```
  - Add both to the `.omit({...})` list on `projectCreateSchema`, alongside `priority`, `staff_assigned_name`, `pic_name` — these must never be settable through the generic create/update payload.

---

## Phase 2: Express Server API (`apps/server`)

### 2.1 Migration (`apps/server/src/db/migrate.ts`)
- [ ] Add two columns to the existing `migrateColumns()` additions array, following the exact pattern already used for `pic_id`/`issues`:
  ```typescript
  { table: 'projects', column: 'uploaded_doc_id', type: 'VARCHAR' },
  { table: 'projects', column: 'uploaded_doc_name', type: 'VARCHAR' },
  ```
  This is additive and idempotent (`columnExists` guard already present) — no new migration mechanism needed. `exportSnapshots(['projects'])` already fires when any column is altered.

### 2.2 Drive service extensions (`apps/server/src/modules/drive/driveService.ts`)
Extend the existing file — do not create a new `lib/drive.ts`. This keeps `getDriveClient()`, `resolveRootFolderId()`, and `GoogleError` as the single source of Drive access.

- [ ] **`extractFolderId(input: string): string`** — if `input` matches `/folders\/([a-zA-Z0-9_-]+)/`, return the captured group (also strip a trailing `?usp=...` query if present); otherwise treat `input` itself as a raw folder ID. This must match the URL shape the app already generates in `resolveFolderUrl` (`https://drive.google.com/drive/folders/${folderId}`), so folder links the app itself produced always round-trip.
- [ ] **`verifyFolderExists(folderId: string): Promise<{ id: string; name: string }>`** — calls `drive.files.get({ fileId: folderId, fields: 'id, name, mimeType' })`, throws `DriveError('Folder not found or not accessible', 404)` if the call fails or `mimeType` isn't the folder MIME type.
- [ ] **`linkFolder(projectId: string, folderInput: string): Promise<void>`** — resolves the folder id via `extractFolderId`, verifies it with `verifyFolderExists`, then `runWrite`s `UPDATE projects SET drive_folder_id = ? WHERE id = ?`, followed by `exportSnapshots(['projects'])`.
- [ ] **`createAndLinkFolder(projectId: string, folderName?: string): Promise<string>`** — looks up the project's `project_name` for the default folder name, calls the existing `createProjectFolder`, then the same `UPDATE` + export as above. Returns the new folder id.
- [ ] **`uploadDocument(projectId: string, file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<UploadedDoc>`**
  - Re-read the project's `drive_folder_id` inside the call (not trusted from the client). If `null`, throw `DriveError('Project has no linked Google Drive folder', 400)`.
  - Convert `file.buffer` to a `Readable` (`Readable.from(file.buffer)`), call `drive.files.create({ requestBody: { name: file.originalname, parents: [folderId] }, media: { mimeType: file.mimetype, body: stream }, fields: 'id, name' })`.
  - `runWrite` an `UPDATE projects SET uploaded_doc_id = ?, uploaded_doc_name = ? WHERE id = ?`, then `exportSnapshots(['projects'])`.
  - Return `{ id, name }`.

### 2.3 Routes (`apps/server/src/modules/drive/routes.ts`)
Add to the existing `driveRouter` (already has `/resolve/:projectId`, `/browse`) rather than a new router:

- [ ] **`POST /api/drive/:projectId/link`** — `requireRole('SUPER_ADMIN')`. Body validated against `linkDriveFolderSchema`. Calls `linkFolder`. Returns `200`.
- [ ] **`POST /api/drive/:projectId/create-folder`** — `requireRole('SUPER_ADMIN')`. Body validated against `createDriveFolderSchema`. Calls `createAndLinkFolder`. Returns `201` with `{ folderId }`.
- [ ] **`POST /api/drive/:projectId/upload`** — `requireAuth` only at the router level (already applied); add an inline ownership check in the handler:
  ```typescript
  const project = await fetchProjectOwnerCheck(projectId); // small helper: SELECT staff_assigned_id
  if (!project) return res.status(404)...
  if (req.user.role !== 'SUPER_ADMIN' && project.staff_assigned_id !== req.user.id) {
    return res.status(403).json({ error: 'Cannot upload documents to a project assigned to another staff member' });
  }
  ```
  This mirrors the exact check already in `pendingEditsService.submitUpdate`, just without the pending-edit write. Use `multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file')` as request middleware ahead of the handler. Returns `200` with `{ id, name }`.
- [ ] **`GET /api/drive/:projectId/files`** — any authenticated role (matches `/resolve/:projectId`'s current openness), lists folder contents via the existing `listChildren`. Rejects with the existing `503`/`400` `DriveError` semantics if unconfigured or unlinked.

### 2.4 Handler wiring
- [ ] Reuse the existing `handleError` in `routes.ts` (already handles `DriveError` + `ZodError`) — no new error-handling pattern needed.

---

## Phase 3: Web Frontend (`apps/web`)

### 3.1 RBAC helper (`apps/web/src/lib/rbac.ts`)
- [ ] Add `canManageDriveFolder(role) { return role === 'SUPER_ADMIN'; }` alongside the existing helpers, for gating the link/create-folder UI. (Upload visibility is ownership-based, not role-based — computed inline against `project.staff_assigned_id`, same as the existing Sales-column `adminOnly` pattern combined with a staff-id comparison.)

### 3.2 Folder link/create control
- [ ] Add to `EditProjectModal.tsx`'s `ReadOnlyBadges` area (where the Drive folder link is already displayed) — but only rendered when `isAdmin`. Two actions: "Link existing folder" (text input, calls `POST /:projectId/link`) and "Create folder" (button, calls `POST /:projectId/create-folder`). On success, invalidate the `['projects', ...]` query key so the grid/modal refetch and show the new link — same invalidation pattern already used by `useUpdateAgingThresholds`, etc.
- [ ] New hook file `apps/web/src/hooks/useDriveActions.ts` with `useLinkFolder()` / `useCreateFolder()` / `useUploadDocument()` mutations, following the existing `useMutation` + `invalidateQueries` shape seen throughout `useSettings.ts`/`useDashboard.ts`.

### 3.3 "Document" grid column
- [ ] New custom cell in `apps/web/src/components/data-grid/columns.tsx`, alongside `driveLinkColumn` (same non-editable custom-cell pattern, not the generic `EditableCell` text/select mechanism):
  - If `uploaded_doc_id` is set: render the filename as a link to `https://drive.google.com/file/d/${uploaded_doc_id}/view`, plus a small "replace" upload icon next to it.
  - If not set: render an upload icon/button only.
  - The upload control is **disabled** (grayed out, `title="Link a Drive folder first"`) whenever `row.original.drive_folder_id` is falsy — per your instruction, this is a hard client-side disable, not just a warning-on-click.
  - The control is only interactive (enabled) for `SUPER_ADMIN` or when `row.original.staff_assigned_id === currentUser.id` — same ownership condition as the upload route itself, so the grid never shows an affordance the server would reject.
  - Clicking opens a native `<input type="file">` (hidden, triggered programmatically) and calls `useUploadDocument().mutate({ projectId, file })` on selection.

### 3.4 Toasts
- [ ] Reuse the existing `useToast()` — success: `"Document uploaded."` / `"Folder linked."` / `"Folder created."`; failure: surface the server's `DriveError` message directly (matches the existing pattern in `GridPage.tsx`'s `handleRowUpdate`/`handleAddProject`).

---

## Phase 4: Testing (Playwright e2e)

New spec: `apps/web/e2e/drive-integration.spec.ts`, following the existing login/assertion conventions used in `grid.spec.ts` / `priority.spec.ts`.

| Test | Setup | Expected |
| :--- | :--- | :--- |
| Admin links an existing folder | Admin opens edit modal for a project, pastes a valid Drive folder URL | `200`; folder link now shown in the modal and grid |
| Admin creates a new folder | Admin clicks "Create folder" with no existing link | `201`; new folder id persisted and displayed |
| Staff cannot see link/create controls | Staff opens their own project's edit modal | Link/create controls are entirely absent (not just disabled) |
| Staff cannot call link endpoint directly | Staff sends `POST /api/drive/:id/link` with a valid staff token | `403` |
| Upload disabled with no folder | Any role views a project with `drive_folder_id = null` | Upload control renders disabled |
| Admin uploads a document | Admin project has a linked folder | `200`; `uploaded_doc_name` updates in the grid immediately (no approval step) |
| Assigned staff uploads a document | Staff's own assigned project has a linked folder | `200`; applies immediately, no entry created in `pending_edits` |
| Staff cannot upload to another staff member's project | Staff attempts upload via direct API call on a project assigned to someone else | `403` |
| Replacing a document | Project already has `uploaded_doc_id` set | New upload overwrites `uploaded_doc_id`/`uploaded_doc_name`; old Drive file is left orphaned (not asserted, just not deleted) |

---

## Open Items For Later (explicitly out of scope now)
- Deleting the orphaned previous file on replace.
- True zero-buffer streaming upload (would require moving off `multer` memory storage).
- Multi-file / file-list support (explicitly deferred — this is the "temporary single-slot" version).
- File-type/extension restrictions on upload.
