import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { commitProjectImport, ImportError, previewProjectImport } from './importService.js';

export const importRouter = Router();

// SUPER_ADMIN only (plan §1 non-goals: no STAFF imports). Role comes from the
// verified token via requireAuth — never from the payload.
importRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

// POST /api/import/projects/preview — validate and count; writes nothing.
importRouter.post('/projects/preview', async (req, res) => {
  try {
    res.json(await previewProjectImport(req.body));
  } catch (err) {
    handleImportError(err, res);
  }
});

// POST /api/import/projects/commit — re-validate, then all-or-nothing write.
importRouter.post('/projects/commit', async (req, res) => {
  try {
    res.json(await commitProjectImport(req.user!, req.body));
  } catch (err) {
    handleImportError(err, res);
  }
});

function handleImportError(err: unknown, res: Response): void {
  if (err instanceof ImportError) {
    res.status(err.statusCode).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Import error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
