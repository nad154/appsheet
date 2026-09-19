import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getIssueHistory, addIssue, IssuesError } from './issuesService.js';

const idParam = z.object({ id: z.string().uuid() });

export const issuesRouter = Router();
issuesRouter.use(requireAuth);

// SUPER_ADMIN only — full history of a project's logged issues. STAFF never
// reaches this; they only ever see the latest issue in their scoped grid.
issuesRouter.get('/:id/issues', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    res.json(await getIssueHistory(id));
  } catch (err) {
    handleError(err, res);
  }
});

// SUPER_ADMIN only — logs a new issue AND syncs projects.issues to its text.
issuesRouter.post('/:id/issues', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await addIssue(req.user!, id, req.body));
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof IssuesError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  console.error('Issues error:', err);
  res.status(500).json({ error: 'Internal server error' });
}