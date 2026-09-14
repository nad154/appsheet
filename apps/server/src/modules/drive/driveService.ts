import { runRead, runWrite } from '../../db/connection.js';
import { exportSnapshots } from '../../db/export.js';
import { Readable } from 'node:stream';
import { getDriveClient, resolveRootFolderId, isGoogleConfigured, GoogleError } from '../google/auth.js';
import type { DriveFolderInfo, DriveFileEntry, UploadedDoc } from '@tracker/shared';

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

/** Link an existing Drive folder to a project, overwriting drive_folder_id. */
export async function linkFolder(projectId: string, folderInput: string): Promise<void> {
  const folderId = extractFolderId(folderInput);
  await verifyFolderExists(folderId);
  await runWrite(async (ex) => {
    await ex(`UPDATE projects SET drive_folder_id = ? WHERE id = ?`, [folderId, projectId]);
  });
  await exportSnapshots(['projects']);
}

/**
 * Create a new Drive subfolder (defaulting to the project's project_name) and
 * link it to the project. Returns the new folder's Drive id.
 */
export async function createAndLinkFolder(projectId: string, folderName?: string): Promise<string> {
  const rows = await runRead<{ project_name: string }>(
    `SELECT project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const name = folderName ?? rows[0]?.project_name ?? 'Untitled project';
  const folderId = await createProjectFolder(name);
  await runWrite(async (ex) => {
    await ex(`UPDATE projects SET drive_folder_id = ? WHERE id = ?`, [folderId, projectId]);
  });
  await exportSnapshots(['projects']);
  return folderId;
}

/**
 * Upload a document into the project's linked Drive folder and store the
 * reference on the project row. The drive_folder_id is re-read server-side
 * (never trusted from the client); the upload requires a linked folder.
 * Replacing a document orphans the previous Drive file (not deleted).
 */
export async function uploadDocument(
  projectId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
): Promise<UploadedDoc> {
  requireConfigured();
  const rows = await runRead<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM projects WHERE id = ?`,
    [projectId],
  );
  const folderId = rows[0]?.drive_folder_id ?? null;
  if (!folderId) {
    throw new DriveError('Project has no linked Google Drive folder', 400);
  }

  const drive = getDriveClient();
  const body = Readable.from(file.buffer);
  const res = await drive.files.create({
    requestBody: { name: file.originalname, parents: [folderId] },
    media: { mimeType: file.mimetype, body },
    fields: 'id, name',
  });
  if (!res.data.id) {
    throw new DriveError('Drive API returned no file id', 502);
  }

  const uploadId = res.data.id;
  const uploadName = res.data.name ?? file.originalname;

  await runWrite(async (ex) => {
    await ex(
      `UPDATE projects SET uploaded_doc_id = ?, uploaded_doc_name = ? WHERE id = ?`,
      [uploadId, uploadName, projectId],
    );
  });
  await exportSnapshots(['projects']);

  return { id: uploadId, name: uploadName };
}

/** Minimal owner lookup for the upload route's ownership check (SELECT only). */
export async function fetchProjectOwnerCheck(
  projectId: string,
): Promise<{ staff_assigned_id: string | null } | null> {
  const rows = await runRead<{ staff_assigned_id: string | null }>(
    `SELECT staff_assigned_id FROM projects WHERE id = ?`,
    [projectId],
  );
  return rows[0] ?? null;
}

/** Look up a project's linked Drive folder id (null when unlinked/not found). */
export async function resolveProjectFolderId(projectId: string): Promise<string | null> {
  const rows = await runRead<{ drive_folder_id: string | null }>(
    `SELECT drive_folder_id FROM projects WHERE id = ?`,
    [projectId],
  );
  return rows[0]?.drive_folder_id ?? null;
}

export { GoogleError };
