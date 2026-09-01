import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveFolderUrl, listChildren, DriveError } from './driveService.js';

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
