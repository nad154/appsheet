import { runRead } from '../../db/connection.js';
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
    fields: 'files(id, name, mimeType, webViewLink)',
    orderBy: 'name',
    pageSize: 500,
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    webViewLink: f.webViewLink ?? null,
  }));
}

export { GoogleError };
