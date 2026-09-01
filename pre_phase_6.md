# Phase 6 — Google Integrations: Pre-Implementation Plan

## Decisions (Confirmed)

| Decision | Value |
|---|---|
| Gmail recipients | Single SUPER_ADMIN (from `DIGEST_RECIPIENT_EMAIL` env var) |
| Drive folder creation | Auto-create on project creation |
| Root folder | Named `"root_folder"` — resolved by name lookup at startup |
| Auth method | Google service account |

---

## What You Need to Provide Before Implementation Starts

1. **Service account JSON key file** → place at `apps/server/secrets/service-account.json`
   - The service account must have Drive API and Gmail API enabled in its Google Cloud project
   - The service account email must be shared on the root Drive folder as Editor (to create subfolders)

2. **Real `DIGEST_RECIPIENT_EMAIL`** → update in `apps/server/.env`
   - This is the single SUPER_ADMIN email that receives the daily digest

3. **Confirm the root folder exists** → a Drive folder named exactly `"root_folder"` must exist in the Drive account accessible to the service account

4. **Gmail sending setup** (one of):
   - **Google Workspace**: Enable domain-wide delegation on the service account for `gmail.send` scope, impersonating the admin mailbox — OR
   - **Non-Workspace / Consumer Gmail**: Provide an OAuth2 refresh token + designated Gmail account, or an SMTP app password for Nodemailer fallback

---

## Implementation Steps

### Step 1 — Google Auth Client

**New file:** `apps/server/src/modules/google/auth.ts`

- Load `GOOGLE_APPLICATION_CREDENTIALS` from env via `google.auth.GoogleAuth`
- Export a singleton `googleAuth` client scoped to Drive + Gmail scopes
- Export `getDriveClient()` and `getGmailClient()` helpers
- On startup: resolve root folder ID by listing Drive files with `name = 'root_folder'` and `mimeType = 'application/vnd.google-apps.folder'`. Cache the result. Error loudly if not found.

### Step 2 — Drive Module Backend

**New files:** `apps/server/src/modules/drive/driveService.ts`, `apps/server/src/modules/drive/routes.ts`

| Function | Purpose |
|---|---|
| `resolveFolderUrl(projectId)` | Read `drive_folder_id` from projects. Return `{ url, folderId }` or `{ url: null }` |
| `createProjectFolder(projectName, projectFolderName?)` | Create a subfolder under cached root via Drive API. Return new folder `id` |
| `listChildren(folderId?)` | List one level of children (or root if null). Returns `{ id, name, mimeType, webViewLink }[]` |

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/drive/resolve/:projectId` | requireAuth | Returns Drive folder URL for a project |
| `GET /api/drive/browse?folderId=` | requireAuth + requireRole('SUPER_ADMIN') | Lists children of a folder (lazy-load) |

**Mount in `app.ts`:** `app.use('/api/drive', driveRouter)`

### Step 3 — Wire Folder Creation into Project Create Flows

**Modify:** `apps/server/src/modules/pending-edits/pendingEditsService.ts`

1. **`createDirect()`** (SUPER_ADMIN direct create): After inserting the project row, call `createProjectFolder(projectName, folderName)`. Update `drive_folder_id`. Export parquet.

2. **`approve()` CREATE branch** (STAFF proposal approved): After inserting the approved project row, call `createProjectFolder()`. Update `drive_folder_id`. Export parquet.

Both calls happen inside the existing `runWrite` block. If the Drive API call fails, the entire write rolls back — no orphaned projects without folders.

### Step 4 — Gmail Digest Service

**New files:** `apps/server/src/modules/gmail/gmailService.ts`, `apps/server/src/modules/gmail/routes.ts`

| Function | Purpose |
|---|---|
| `buildDigestHtml()` | Query projects matching idle (`updated_at < now - 14 days`) or deadline approaching (`*_end_contract` within 7 days) using `IDLE_THRESHOLD_DAYS` / `DEADLINE_WARNING_DAYS` from `@tracker/shared`. Render a simple HTML table email |
| `sendDigest()` | Build HTML, construct RFC 2822 MIME, base64url encode, send via `gmail.users.messages.send` |
| `previewDigest()` | Same as `sendDigest()` but returns HTML without sending |

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/admin/digest/send-now` | requireAuth + requireRole('SUPER_ADMIN') | Immediate digest send. Returns `{ sent: true, count }` |
| `GET /api/admin/digest/preview` | requireAuth + requireRole('SUPER_ADMIN') | Returns `{ html }` for preview |

**Mount in `app.ts`:** `app.use('/api/admin', adminRouter)`

### Step 5 — Cron Job

**New file:** `apps/server/src/jobs/digestJob.ts`

- Use `node-cron` to schedule `sendDigest()` on `DIGEST_CRON` env var (default `0 6 * * *`)
- Start the cron job in `server.ts` after `migrate()` completes
- Wrap in try/catch — log errors, never crash the process
- Also resolve root folder ID on startup (from Step 1) before starting the cron

### Step 6 — Shared Schemas

**New files:** `packages/shared/src/schemas/drive.ts`, `packages/shared/src/schemas/digest.ts`

```ts
// drive.ts
// DriveFolderInfo — { url: string | null, folderId: string | null }
// DriveFileEntry — { id: string, name: string, mimeType: string, webViewLink: string }

// digest.ts
// DigestPreview — { html: string }
// DigestSendResult — { sent: boolean, count: number }
```

**Modify:** `packages/shared/src/index.ts` — add exports for new schemas.

### Step 7 — Frontend: Drive Browser

**New file:** `apps/web/src/app/drive-browser/DriveBrowserPage.tsx`

- Lazy-loaded tree view: start at root, clicking a folder fetches children via `GET /api/drive/browse?folderId=`
- Display folder/file names with appropriate icons
- "Open in Drive" link for folders (opens `webViewLink` in new tab)
- Loading states for folder expansion
- SUPER_ADMIN only (already gated in `App.tsx`)

**Modify:** `apps/web/src/App.tsx` — replace the placeholder div with the real `DriveBrowserPage` component.

### Step 8 — Frontend Hooks

**New file:** `apps/web/src/hooks/useDrive.ts`

| Hook | Purpose |
|---|---|
| `useDriveResolve(projectId)` | Query `GET /api/drive/resolve/:projectId` — used by grid for Drive links |
| `useDriveBrowse(folderId)` | Query `GET /api/drive/browse?folderId=` — used by DriveBrowserPage |
| `useSendDigest()` | Mutation `POST /api/admin/digest/send-now` |
| `useDigestPreview()` | Query `GET /api/admin/digest/preview` |

### Step 9 — Frontend: Drive Links in Grid

Modify the grid to show a Drive icon/link column. Uses `useDriveResolve` for visible rows. When `drive_folder_id` is set, render a clickable link to the Drive folder URL.

### Step 10 — Frontend: Digest Admin Controls

Add a "Send Digest Now" button and "Preview" link to the Settings page. Uses `useSendDigest()` and `useDigestPreview()` hooks.

---

## Files Summary

### New Files (10)

| File | Purpose |
|---|---|
| `apps/server/src/modules/google/auth.ts` | Shared Google auth client + root folder resolution |
| `apps/server/src/modules/drive/driveService.ts` | Drive folder operations |
| `apps/server/src/modules/drive/routes.ts` | Drive API endpoints |
| `apps/server/src/modules/gmail/gmailService.ts` | Digest query, HTML template, Gmail send |
| `apps/server/src/modules/gmail/routes.ts` | Admin digest endpoints |
| `apps/server/src/jobs/digestJob.ts` | Cron job scheduling |
| `packages/shared/src/schemas/drive.ts` | Drive response types |
| `packages/shared/src/schemas/digest.ts` | Digest response types |
| `apps/web/src/app/drive-browser/DriveBrowserPage.tsx` | Drive Browser UI |
| `apps/web/src/hooks/useDrive.ts` | Drive + digest hooks |

### Files to Modify (6)

| File | Change |
|---|---|
| `apps/server/src/app.ts` | Mount drive + admin routers |
| `apps/server/src/server.ts` | Init Google auth + start cron on boot |
| `apps/server/src/modules/pending-edits/pendingEditsService.ts` | Add Drive folder creation in `createDirect()` and `approve()` CREATE branch |
| `apps/server/.env` | Add real `DIGEST_RECIPIENT_EMAIL` value |
| `apps/web/src/App.tsx` | Replace drive-browser placeholder with real component |
| `packages/shared/src/index.ts` | Export new schemas |
