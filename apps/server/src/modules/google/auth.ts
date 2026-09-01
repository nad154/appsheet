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
