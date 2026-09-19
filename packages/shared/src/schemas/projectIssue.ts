import { z } from 'zod';

// Body for POST /api/projects/:id/issues (SUPER_ADMIN only). issue_date
// defaults to today server-side when omitted; assignee_id defaults to null.
export const issueCreateSchema = z.object({
  issue_text: z.string().trim().min(1, 'Issue text is required'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD').optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});
export type IssueCreate = z.infer<typeof issueCreateSchema>;

// One logged issue, joined to users for display names.
export const projectIssueEntrySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  issue_text: z.string(),
  issue_date: z.string(),
  assignee_id: z.string().uuid().nullable(),
  assignee_name: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type ProjectIssueEntry = z.infer<typeof projectIssueEntrySchema>;

// GET /api/projects/:id/issues response (SUPER_ADMIN only).
export const projectIssueHistorySchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string(),
  entries: z.array(projectIssueEntrySchema),
});
export type ProjectIssueHistory = z.infer<typeof projectIssueHistorySchema>;