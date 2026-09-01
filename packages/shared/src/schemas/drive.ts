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
});

export type DriveFolderInfo = z.infer<typeof driveFolderInfoSchema>;
export type DriveFileEntry = z.infer<typeof driveFileEntrySchema>;
