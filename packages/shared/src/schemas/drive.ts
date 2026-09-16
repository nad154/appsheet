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

// POST /api/drive/:projectId/link request body.
export const linkDriveFolderSchema = z.object({
  folderInput: z.string().min(1, 'Folder ID or Google Drive URL is required'),
});

// POST /api/drive/:projectId/create-folder request body.
export const createDriveFolderSchema = z.object({
  folderName: z.string().min(1).optional(),
});

export type DriveFolderInfo = z.infer<typeof driveFolderInfoSchema>;
export type DriveFileEntry = z.infer<typeof driveFileEntrySchema>;
