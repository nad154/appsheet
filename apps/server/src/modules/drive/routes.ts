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
    await linkFolder(projectId, payload.folderInput);
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