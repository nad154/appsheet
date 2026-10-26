# UNUSED_DRIVE

Archive of the removed Google Drive folder feature.

Removed from the running app:

- Drive Browser tab/page
- Edit Project modal folder URL/ID and link/create-folder controls
- Grid quick-link Drive modal
- Drive REST API + Drive service + Google Drive auth helper
- Automatic Drive folder creation when a project is created
- Shared Drive Zod schemas/types
- Drive integration e2e tests

The `projects.drive_folder_id` database column was intentionally **not** dropped.
It is now a stale column, as requested. `projects.folder_name` is also kept: it is
still used as the app's internal "Folder Reference", not as a Drive link.

The sections below list the original filename where each removed piece belonged.

---

## Deleted file: `apps/web/src/app/drive-browser/DriveBrowserPage.tsx`

```tsx
import { useState } from 'react';
import { useDriveBrowse } from '../../hooks/useDrive';
import type { DriveFileEntry } from '@tracker/shared';
import { FolderIcon, FileIcon, ChevronDownIcon, ChevronRightIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function isFolder(entry: DriveFileEntry): boolean {
  return entry.mimeType === FOLDER_MIME;
}

interface FolderNodeProps {
  folderId: string | null; // null = root level
  label: string;
  depth: number;
}

function FolderNode({ folderId, label, depth }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: children, isLoading, isError, error } = useDriveBrowse(expanded ? folderId : null);

  const toggle = () => setExpanded((e) => !e);
  const indent = { paddingLeft: `${depth * 16 + 4}px` };

  return (
    <li>
      <div className="flex items-center gap-2 py-1" style={indent}>
        <button
          type="button"
          onClick={toggle}
          className="inline-flex min-w-6 items-center justify-center rounded text-ink-muted hover:bg-canvas"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        >
          {isLoading ? (
            '…'
          ) : expanded ? (
            <ChevronDownIcon size={14} aria-hidden="true" />
          ) : (
            <ChevronRightIcon size={14} aria-hidden="true" />
          )}
        </button>
        <FolderIcon size={15} aria-hidden="true" className="shrink-0 text-accent" />
        <span className="truncate text-sm font-medium text-ink">{label}</span>
      </div>
      {expanded && (
        <ul>
          <ChildrenList {...{ children, isLoading, isError, error, depth: depth + 1 }} />
        </ul>
      )}
    </li>
  );
}

function ChildrenList({
  children,
  isLoading,
  isError,
  error,
  depth,
}: {
  children: DriveFileEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  depth: number;
}) {
  const indent = { paddingLeft: `${depth * 16 + 4}px` };

  if (isLoading && !children) return <li style={indent} className="py-1 text-xs text-ink-muted">Loading…</li>;
  if (isError && !children) {
    return (
      <li style={indent} className="py-1 text-xs text-danger">
        {error instanceof Error ? error.message : 'Failed to load folder.'}
      </li>
    );
  }
  if (!children || children.length === 0) {
    return <li style={indent} className="py-1 text-xs text-ink-muted">Empty folder</li>;
  }

  return (
    <>
      {children.map((entry) =>
        isFolder(entry) ? (
          <FolderNode key={entry.id} folderId={entry.id} label={entry.name} depth={depth} />
        ) : (
          <li key={entry.id} style={indent} className="flex items-center gap-2 py-1">
            <FileIcon size={15} aria-hidden="true" className="shrink-0 text-ink-muted" />
            <span className="truncate text-sm text-ink">{entry.name}</span>
          </li>
        ),
      )}
    </>
  );
}

export function DriveBrowserPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Drive Browser" />
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        <ul>
          <FolderNode folderId={null} label="root_folder" depth={0} />
        </ul>
      </div>
    </div>
  );
}
```

---

## Deleted file: `apps/web/src/components/data-grid/LinkDriveModal.tsx`

```tsx
import { useState } from 'react';
import type { Project } from '@tracker/shared';
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import type { ToastVariant } from '../Toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { controlClass } from '../ui/Input';

// Quick Drive-folder modal opened from the grid's Folder column when a project
// has no linked folder (SUPER_ADMIN only). Two actions:
//   - Link to existing drive: paste a Drive folder URL/ID (optionally a display
//     name, which is stored as the project's folder_name).
//   - Create drive folder: new Drive subfolder named after the input, linked
//     and stored under folder_name too.
interface LinkDriveModalProps {
  project: Project;
  onClose: () => void;
  onNotice?: (message: string, variant?: ToastVariant) => void;
}

export function LinkDriveModal({ project, onClose, onNotice }: LinkDriveModalProps) {
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [linkInput, setLinkInput] = useState('');
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkFolder = useLinkFolder();
  const createFolder = useCreateFolder();

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const name = folderName.trim();
    try {
      if (mode === 'link') {
        await linkFolder.mutateAsync({
          projectId: project.id,
          folderInput: linkInput.trim(),
          ...(name ? { folderName: name } : {}),
        });
        onNotice?.('Folder linked.', 'success');
      } else {
        await createFolder.mutateAsync({ projectId: project.id, folderName: name });
        onNotice?.('Drive folder created and linked.', 'success');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link the folder.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === 'link' ? linkInput.trim().length > 0 : folderName.trim().length > 0;

  return (
    <Modal
      ariaLabel={`Link Drive folder for ${project.project_name}`}
      eyebrow="Drive folder"
      title={project.project_name}
      onClose={onClose}
      maxWidthClass="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !canSubmit}>
            {busy ? 'Saving…' : mode === 'link' ? 'Link folder' : 'Create folder'}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-4 flex gap-2">
          {(
            [
              { id: 'link' as const, label: 'Link to existing drive' },
              { id: 'create' as const, label: 'Create drive folder' },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setError(null);
              }}
              aria-pressed={mode === tab.id}
              className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-border text-ink-muted hover:bg-canvas'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Drive folder URL or ID
              <input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/… or folder ID"
                aria-label="Drive folder URL or ID"
                className={controlClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Folder name <span className="font-normal text-ink-muted/70">(optional — shown in the grid)</span>
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Name shown in the Folder column"
                aria-label="Folder name"
                className={controlClass}
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Creates a new folder inside the app's Drive root and links it to this project.
            </p>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Folder name
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Folder name"
                aria-label="Folder name"
                className={controlClass}
              />
            </label>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
```

---

## Deleted file: `apps/web/src/hooks/useDrive.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { DriveFileEntry, DriveFolderInfo } from '@tracker/shared';

export function useDriveResolve(projectId: string | null) {
  const query = useQuery({
    queryKey: ['drive', 'resolve', projectId],
    queryFn: () => apiClient.get<DriveFolderInfo>(`/api/drive/resolve/${projectId}`),
    enabled: Boolean(projectId),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useDriveBrowse(folderId: string | null) {
  const query = useQuery({
    queryKey: ['drive', 'browse', folderId ?? 'root'],
    queryFn: () =>
      apiClient.get<DriveFileEntry[]>(
        folderId ? `/api/drive/browse?folderId=${encodeURIComponent(folderId)}` : '/api/drive/browse',
      ),
    enabled: true,
    placeholderData: (prev) => prev,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useRefreshDriveBrowse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderId: string | null) => {
      await qc.invalidateQueries({ queryKey: ['drive', 'browse', folderId ?? 'root'] });
    },
  });
}
```

---

## Deleted file: `apps/web/src/hooks/useDriveActions.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// Drive mutations for the folder link/create controls. On success each
// invalidates the projects query so the grid/modal refetch and show the
// updated drive_folder_id value.

export function useLinkFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; folderInput: string; folderName?: string }) =>
      apiClient.post<{ ok: boolean }>(`/api/drive/${input.projectId}/link`, {
        folderInput: input.folderInput,
        ...(input.folderName ? { folderName: input.folderName } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['drive'] });
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; folderName?: string }) =>
      apiClient.post<{ folderId: string }>(`/api/drive/${input.projectId}/create-folder`, {
        folderName: input.folderName,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['drive'] });
    },
  });
}
```

---

## Deleted file: `apps/server/src/modules/drive/routes.ts`

```ts
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  resolveFolderUrl,
  listChildren,
  linkFolder,
  createAndLinkFolder,
  resolveProjectFolderId,
  DriveError,
} from './driveService.js';
import { linkDriveFolderSchema, createDriveFolderSchema } from '@tracker/shared';

const idParamSchema = z.object({ projectId: z.string().uuid() });
const browseQuerySchema = z.object({ folderId: z.string().optional() });

export const driveRouter = Router();
driveRouter.use(requireAuth);

// GET /api/drive/resolve/:projectId — Drive folder URL for a project (any role).
driveRouter.get('/resolve/:projectId', async (req, res) => {
  try {
    const { projectId } = idParamSchema.parse(req.params);
    res.json(await resolveFolderUrl(projectId));
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/drive/browse?folderId= — lazy-load children of a folder (SUPER_ADMIN).
driveRouter.get('/browse', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const parsed = browseQuerySchema.parse(req.query);
    res.json(await listChildren(parsed.folderId));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/drive/:projectId/link — link an existing folder (SUPER_ADMIN only).
driveRouter.post('/:projectId/link', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { projectId } = idParamSchema.parse(req.params);
    const payload = linkDriveFolderSchema.parse(req.body);
    await linkFolder(projectId, payload.folderInput, payload.folderName);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/drive/:projectId/create-folder — create + link a new folder
// (SUPER_ADMIN only). Returns 201 with the new folder's Drive id.
driveRouter.post('/:projectId/create-folder', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { projectId } = idParamSchema.parse(req.params);
    const payload = createDriveFolderSchema.parse(req.body);
    const folderId = await createAndLinkFolder(projectId, payload.folderName);
    res.status(201).json({ folderId });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /api/drive/:projectId/files — list contents of a project's linked folder
// (any authenticated role, matching /resolve/:projectId's openness).
driveRouter.get('/:projectId/files', async (req, res) => {
  try {
    const { projectId } = idParamSchema.parse(req.params);
    const folderId = await resolveProjectFolderId(projectId);
    if (!folderId) throw new DriveError('Project has no linked Google Drive folder', 400);
    res.json(await listChildren(folderId));
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof DriveError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Drive error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

---

## Deleted file: `apps/server/src/modules/drive/driveService.ts`

```ts
import { runRead, runWrite } from '../../db/connection.js';
import { exportSnapshots } from '../../db/export.js';
import { getDriveClient, resolveRootFolderId, isGoogleConfigured, GoogleError } from '../google/auth.js';
import type { DriveFolderInfo, DriveFileEntry } from '@tracker/shared';

export class DriveError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'DriveError';
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function requireConfigured(): void {
  if (!isGoogleConfigured()) {
    throw new DriveError(
      'Google Drive is not configured. Check GOOGLE_APPLICATION_CREDENTIALS and the service-account.json key.',
      503,
    );
  }
}

interface ProjectRow {
  drive_folder_id: string | null;
  [key: string]: unknown;
}

/**
 * Returns the Drive folder URL for a project from its stored drive_folder_id.
 * We use the stored id (set at creation time), never a by-name lookup, so the
 * deep link stays stable if the folder is later renamed.
 */
export async function resolveFolderUrl(projectId: string): Promise<DriveFolderInfo> {
  const rows = await runRead<ProjectRow>(`SELECT drive_folder_id FROM projects WHERE id = ?`, [projectId]);
  const folderId = rows[0]?.drive_folder_id ?? null;
  if (!folderId) return { url: null, folderId: null };
  return { url: `https://drive.google.com/drive/folders/${folderId}`, folderId };
}

/**
 * Create a subfolder under the cached root folder. Returns the new folder's
 * Google Drive id. Used at project-creation time so every project gets a 1:1
 * Drive folder. Throws on failure so the calling write transaction rolls back.
 */
export async function createProjectFolder(name: string): Promise<string> {
  requireConfigured();
  const drive = getDriveClient();
  const rootId = await resolveRootFolderId();

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [rootId],
    },
    fields: 'id, name',
  });

  if (!res.data.id) {
    throw new DriveError('Drive API returned no folder id', 502);
  }
  return res.data.id;
}

/** List one level of children under a folder (or the root folder when null). */
export async function listChildren(folderId?: string): Promise<DriveFileEntry[]> {
  requireConfigured();
  const drive = getDriveClient();
  const parentId = folderId ?? (await resolveRootFolderId());

  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, webViewLink, size)',
    orderBy: 'name',
    pageSize: 500,
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    webViewLink: f.webViewLink ?? null,
    size: f.size ?? undefined,
  }));
}

/**
 * Resolve a folder ID from a Google Drive folder URL or a raw folder ID. The
 * regex matches the URL shape this app itself produces in resolveFolderUrl
 * (https://drive.google.com/drive/folders/<id>), so app-generated links always
 * round-trip. Anything that isn't a recognized URL is treated as a raw ID.
 */
export function extractFolderId(input: string): string {
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const raw = match[1];
    const qIdx = raw.indexOf('?');
    return qIdx === -1 ? raw : raw.slice(0, qIdx);
  }
  return input.trim();
}

/**
 * Confirm a folder ID exists and is actually a Drive folder (not a file).
 * Throws DriveError(404) when the ID is not resolvable or has the wrong MIME
 * type — the caller can then reject the link request.
 */
export async function verifyFolderExists(folderId: string): Promise<{ id: string; name: string }> {
  requireConfigured();
  const drive = getDriveClient();
  try {
    const res = await drive.files.get({ fileId: folderId, fields: 'id, name, mimeType' });
    if (!res.data.id || res.data.mimeType !== FOLDER_MIME) {
      throw new DriveError('Folder not found or not accessible', 404);
    }
    return { id: res.data.id, name: res.data.name ?? '' };
  } catch (err) {
    if (err instanceof DriveError) throw err;
    throw new DriveError('Folder not found or not accessible', 404);
  }
}

/**
 * Link an existing Drive folder to a project, overwriting drive_folder_id. An
 * optional folderName is recorded as the project's display folder_name so the
 * grid's Folder column shows the name immediately.
 */
export async function linkFolder(projectId: string, folderInput: string, folderName?: string): Promise<void> {
  const folderId = extractFolderId(folderInput);
  await verifyFolderExists(folderId);
  await runWrite(async (ex) => {
    if (folderName) {
      await ex(`UPDATE projects SET drive_folder_id = ?, folder_name = ? WHERE id = ?`, [folderId, folderName, projectId]);
    } else {
      await ex(`UPDATE projects SET drive_folder_id = ? WHERE id = ?`, [folderId, projectId]);
    }
  });
  await exportSnapshots(['projects']);
}

/**
 * Create a new Drive subfolder (defaulting to the project's project_name) and
 * link it to the project. Returns the new folder's Drive id. A provided
 * folderName doubles as the Drive folder name and the project's display
 * folder_name.
 */
export async function createAndLinkFolder(projectId: string, folderName?: string): Promise<string> {
  const rows = await runRead<{ project_name: string }>(
    `SELECT project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const name = folderName ?? rows[0]?.project_name ?? 'Untitled project';
  const folderId = await createProjectFolder(name);
  await runWrite(async (ex) => {
    if (folderName) {
      await ex(`UPDATE projects SET drive_folder_id = ?, folder_name = ? WHERE id = ?`, [folderId, folderName, projectId]);
    } else {
      await ex(`UPDATE projects SET drive_folder_id = ? WHERE id = ?`, [folderId, projectId]);
    }
  });
  await exportSnapshots(['projects']);
  return folderId;
}

/**
 * Look up a project's linked Drive folder id (null when unlinked/not found).
 */
export async function resolveProjectFolderId(projectId: string): Promise<string | null> {
  const rows = await runRead<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM projects WHERE id = ?`,
    [projectId],
  );
  return rows[0]?.drive_folder_id ?? null;
}

export { GoogleError };
```

---

## Deleted file: `apps/server/src/modules/google/auth.ts`

```ts
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

let driveClient: drive_v3.Drive | null = null;
let rootFolderId: string | null = null;
let loadAttempted = false;

/**
 * Whether Google credentials are configured. When false, every Google-backed
 * feature returns a clear "not configured" error instead of crashing the boot.
 * The rest of the app (grid / approvals / settings) keeps working regardless.
 */
export function isGoogleConfigured(): boolean {
  const credsPath = resolveCredentialsPath();
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) && fs.existsSync(credsPath);
}

function resolveCredentialsPath(): string {
  const env = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (env && path.isAbsolute(env)) return env;
  // Resolve relative to the server process cwd (apps/server).
  return path.resolve(process.cwd(), env ?? './secrets/service-account.json');
}

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;
  if (!isGoogleConfigured()) {
    throw new GoogleError(
      'Google Drive is not configured: set GOOGLE_APPLICATION_CREDENTIALS and place the service-account.json key',
      503,
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolveCredentialsPath(),
    scopes: DRIVE_SCOPES,
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Resolve the root folder ID. Looks up a Drive folder named exactly
 * `root_folder`. Cached after the first successful call. Throws loudly if the
 * folder cannot be found — a missing root folder is a misconfiguration that
 * should not be silently ignored.
 */
export async function resolveRootFolderId(): Promise<string> {
  if (rootFolderId) return rootFolderId;

  const drive = getDriveClient();
  const res = await drive.files.list({
    q: "name = 'root_folder' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)',
    pageSize: 10,
  });

  const files = res.data.files ?? [];
  const root = files.find((f) => f.id);
  if (!root || !root.id) {
    throw new GoogleError(
      "Drive root folder 'root_folder' not found. Create a folder named exactly 'root_folder' and share it with the service account (Editor).",
      503,
    );
  }

  rootFolderId = root.id;
  return rootFolderId;
}

export class GoogleError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'GoogleError';
  }
}

export { getDriveClient };
```

---

## Deleted file: `packages/shared/src/schemas/drive.ts`

```ts
import { z } from 'zod';

// Drive folder info returned for a project by GET /api/drive/resolve/:projectId.
// url is null when the project has no folder (or not configured).
export const driveFolderInfoSchema = z.object({
  url: z.string().url().nullable(),
  folderId: z.string().nullable(),
});

// One entry in the Drive browser tree (a file or folder).
export const driveFileEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  webViewLink: z.string().nullable(),
  size: z.string().optional(),
});

// POST /api/drive/:projectId/link request body. folderName optionally records
// the display name shown in the Folder column; when omitted only the folder id
// is stored.
export const linkDriveFolderSchema = z.object({
  folderInput: z.string().min(1, 'Folder ID or Google Drive URL is required'),
  folderName: z.string().optional(),
});

// POST /api/drive/:projectId/create-folder request body.
export const createDriveFolderSchema = z.object({
  folderName: z.string().min(1).optional(),
});

export type DriveFolderInfo = z.infer<typeof driveFolderInfoSchema>;
export type DriveFileEntry = z.infer<typeof driveFileEntrySchema>;
```

---

## Deleted file: `apps/web/e2e/drive-integration.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import { scrollGridTo } from './helpers';

// Drive integration access-control tests. These deliberately avoid calling the
// real Google Drive API (no service-account.json in the dev/test environment),
// so they only cover the RBAC + UI-gating surface:
//   - link/create-folder endpoints are SUPER_ADMIN-only

// Deterministic project ids seeded by apps/server/_rbac_setup.ts.
const ADMIN_PROJECT_A_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STAFF_PROJECT_A_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function openRowModal(page, projectName: string) {
  await scrollGridTo(page, projectName);
  const nameCell = page.getByText(projectName, { exact: true });
  await expect(nameCell).toBeVisible();
  await nameCell.hover();

  const pencil = nameCell
    .locator('xpath=ancestor::div[@role="row"]')
    .locator('button[title="Edit project"]');
  await expect(pencil).toBeVisible();
  await pencil.click();

  const dialog = page.getByRole('dialog', { name: `Edit ${projectName}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function staffToken(page): Promise<string> {
  await login(page, 'staff1@example.com', 'staff12345');
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  return token as string;
}

test('admin sees the folder link/create controls in the edit modal', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  const dialog = await openRowModal(page, 'Admin Project A');

  await expect(dialog.getByRole('button', { name: 'Link existing folder' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create folder' })).toBeVisible();
  await expect(dialog.getByLabel('Drive folder URL or ID')).toBeVisible();
});

test('staff does not see the folder link/create controls', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');
  const dialog = await openRowModal(page, 'Staff Project A');

  await expect(dialog.getByRole('button', { name: 'Link existing folder' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Create folder' })).toHaveCount(0);
  await expect(dialog.getByLabel('Drive folder URL or ID')).toHaveCount(0);
});

test('staff cannot call the link endpoint directly', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/link`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { folderInput: 'https://drive.google.com/drive/folders/abc123' },
  });
  expect(res.status()).toBe(403);
});

test('admin opens the quick-link modal from an unlinked folder cell', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await scrollGridTo(page, 'Admin Project A');
  await page.getByLabel('Link Drive folder for Admin Project A').click();

  const dialog = page.getByRole('dialog', { name: 'Link Drive folder for Admin Project A' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Link to existing drive' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create drive folder' })).toBeVisible();
  await expect(dialog.getByLabel('Drive folder URL or ID')).toBeVisible();
  await expect(dialog.getByLabel('Folder name')).toBeVisible();
});

test('staff sees no link affordance on unlinked folder cells', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');
  await expect(page.getByLabel('Link Drive folder for Staff Project A')).toHaveCount(0);
});

test('staff cannot call the create-folder endpoint directly', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/create-folder`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { folderName: 'E2E Should Never Be Created' },
  });
  expect(res.status()).toBe(403);
});
```

---

# Code removed from files that still exist

## `apps/web/src/App.tsx`

```tsx
import { DriveBrowserPage } from './app/drive-browser/DriveBrowserPage';

<Route
  path="/drive-browser"
  element={
    <ProtectedRoute roles={['SUPER_ADMIN']}>
      <DriveBrowserPage />
    </ProtectedRoute>
  }
/>
```

## `apps/web/src/components/AppLayout.tsx`

```tsx
import { canManageDriveFolder, canManageSettings } from '../lib/rbac';

{canManageDriveFolder(user?.role) && <NavItem to="/drive-browser" label="Drive Browser" />}
```

## `apps/web/src/lib/rbac.ts`

```ts
export function canManageDriveFolder(role: Role | undefined): boolean {
  return role === 'SUPER_ADMIN';
}
```

## `apps/web/src/components/data-grid/EditProjectModal.tsx`

```tsx
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import { useToast } from '../Toast';

const [driveFolderId, setDriveFolderId] = useState<string | null>(project.drive_folder_id ?? null);
const [linkInput, setLinkInput] = useState('');
const [busy, setBusy] = useState<'link' | 'create' | null>(null);

const linkFolder = useLinkFolder();
const createFolder = useCreateFolder();
const { showToast } = useToast();

// Mirrors driveService.extractFolderId for display state only — shows the newly
// linked folder in the modal without a refetch. The server remains the single
// authority for the actual link.
function folderIdFromInput(input: string): string {
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const raw = match ? match[1] : input.trim();
  const qIdx = raw.indexOf('?');
  return qIdx === -1 ? raw : raw.slice(0, qIdx);
}

function FolderBadges({
  project,
  isAdmin,
  driveFolderId,
  linkInput,
  busy,
  onLinkInput,
  onLinkFolder,
  onCreateFolder,
}: {
  project: Project;
  isAdmin: boolean;
  driveFolderId: string | null;
  linkInput: string;
  busy: 'link' | 'create' | null;
  onLinkInput: (value: string) => void;
  onLinkFolder: () => void;
  onCreateFolder: () => void;
}) {
  const folderName = project.folder_name;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-muted">
        Folder:{' '}
        {driveFolderId ? (
          <a
            href={`https://drive.google.com/drive/folders/${driveFolderId}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            {folderName || 'open Drive'}
          </a>
        ) : (
          folderName || '—'
        )}
      </span>
      {isAdmin && (
        <>
          <span className="flex items-center gap-1">
            <input
              type="text"
              value={linkInput}
              onChange={(e) => onLinkInput(e.target.value)}
              placeholder="Drive folder URL or ID"
              aria-label="Drive folder URL or ID"
              className="w-48 rounded border border-border px-2 py-0.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              type="button"
              onClick={onLinkFolder}
              disabled={busy !== null || !linkInput.trim()}
              className="rounded-md border border-border bg-surface px-2 py-0.5 text-accent hover:bg-accent-soft disabled:opacity-50"
            >
              {busy === 'link' ? 'Linking…' : 'Link existing folder'}
            </button>
          </span>
          <button
            type="button"
            onClick={onCreateFolder}
            disabled={busy !== null}
            className="rounded-md bg-accent px-2 py-0.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === 'create' ? 'Creating…' : 'Create folder'}
          </button>
        </>
      )}
    </div>
  );
}

const handleLinkFolder = async () => {
  if (busy || !linkInput.trim()) return;
  setBusy('link');
  try {
    await linkFolder.mutateAsync({ projectId: project.id, folderInput: linkInput.trim() });
    setDriveFolderId(folderIdFromInput(linkInput.trim()));
    setLinkInput('');
    showToast('Folder linked.', 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not link folder.', 'error');
  } finally {
    setBusy(null);
  }
};

const handleCreateFolder = async () => {
  if (busy) return;
  setBusy('create');
  try {
    const result = await createFolder.mutateAsync({ projectId: project.id });
    setDriveFolderId(result.folderId);
    showToast('Folder created.', 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not create folder.', 'error');
  } finally {
    setBusy(null);
  }
};

<FolderBadges
  project={project}
  isAdmin={isAdmin}
  driveFolderId={driveFolderId}
  linkInput={linkInput}
  busy={busy}
  onLinkInput={setLinkInput}
  onLinkFolder={handleLinkFolder}
  onCreateFolder={handleCreateFolder}
/>
```

## `apps/web/src/components/data-grid/ProjectTable.tsx`

```tsx
import { LinkDriveModal } from './LinkDriveModal';

const [linkDriveRow, setLinkDriveRow] = useState<Project | null>(null);

onLinkDrive: setLinkDriveRow,

{linkDriveRow && (
  <LinkDriveModal
    project={linkDriveRow}
    onClose={() => setLinkDriveRow(null)}
    onNotice={onNotice}
  />
)}
```

## `apps/web/src/components/data-grid/columns.tsx`

```tsx
// Folder column: shows the linked folder as a Drive deep link, a plain name
// when only folder_name is set, or "—" when unlinked. For SUPER_ADMIN an
// unlinked project's cell is clickable — it opens the quick LinkDriveModal so a
// folder can be linked/created without opening the full edit modal.
// function driveLinkColumn(
//   isAdmin: boolean,
//   onLinkDrive: (project: Project) => void,
// ): ColumnDef<DisplayRow> {
//   return {
//     accessorKey: 'drive_folder_id',
//     header: 'Folder',
//     size: 160,
//     enableSorting: false,
//     cell: ({ row }) => {
//       if (!row.original.isFirstOfGroup) return null;
//       const project = row.original.project;
//       const id = project.drive_folder_id;
//       const name = project.folder_name;
//
//       if (id) {
//         return (
//           <a
//             href={`https://drive.google.com/drive/folders/${id}`}
//             target="_blank"
//             rel="noreferrer"
//             onClick={(e) => e.stopPropagation()}
//             className="text-sm text-blue-600 underline"
//             aria-label="Open Drive folder"
//           >
//             {name || 'Folder'}
//           </a>
//         );
//       }
//
//       const empty = !name ? (
//         <span className="text-ink-muted/50">—</span>
//       ) : (
//         <span className="block truncate text-sm underline">{name}</span>
//       );
//
//       if (!isAdmin) return empty;
//
//       return (
//         <button
//           type="button"
//           onClick={(e) => {
//             e.stopPropagation();
//             onLinkDrive(project);
//           }}
//           className="flex w-full items-center gap-1.5 rounded text-left hover:outline hover:outline-1 hover:outline-accent/40"
//           title="Link a Google Drive folder"
//           aria-label={`Link Drive folder for ${project.project_name}`}
//         >
//           {empty}
//         </button>
//       );
//     },
//   };
// }

// in buildProjectColumns()
onLinkDrive: (project: Project) => void;
// driveLinkColumn(isAdmin, onLinkDrive),

// all getColumnOptions/getColumnGroups/getColumnSizes callers
onLinkDrive: NOOP,

export const DEFAULT_STICKY_COLUMN_IDS = ['number', 'drive_folder_id', 'project_name'];
```

## `apps/server/src/app.ts`

```ts
import { driveRouter } from './modules/drive/routes.js';

app.use('/api/drive', driveRouter);
```

## `apps/server/src/server.ts`

```ts
import { isGoogleConfigured, resolveRootFolderId } from './modules/google/auth.js';

if (isGoogleConfigured()) {
  try {
    await resolveRootFolderId();
    // eslint-disable-next-line no-console
    console.log('Google Drive ready (root folder resolved).');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Google Drive init failed:', err instanceof Error ? err.message : err);
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('Google Drive not configured — skipping init. Set GOOGLE_APPLICATION_CREDENTIALS to enable.');
}
```

## `apps/server/src/modules/projects/projectsService.ts`

```ts
import { createProjectFolder } from '../drive/driveService.js';
import { isGoogleConfigured } from '../google/auth.js';

// Create the 1:1 Drive folder (when Drive is configured) before inserting,
// so a Drive failure rolls back the whole write — no orphaned project.
let driveFolderId: string | null = stored.drive_folder_id ?? null;
if (isGoogleConfigured() && !driveFolderId) {
  driveFolderId = await createProjectFolder(stored.project_name);
}
const values = buildInsertValues(id, { ...stored, drive_folder_id: driveFolderId });
```

## `packages/shared/src/index.ts`

```ts
export * from './schemas/drive.js';
```

## `apps/web/e2e/grid.spec.ts`

```ts
await expect(page.getByRole('link', { name: 'Drive Browser' })).toBeVisible();
```

## `apps/web/src/components/data-grid/DeleteProjectConfirmModal.tsx`

```tsx
<p className="mt-2 text-sm text-ink-muted">
  The linked Google Drive folder is <span className="font-medium text-ink">not</span> deleted. This action
  cannot be undone.
</p>
```
