import { z } from 'zod';

// One user attached to an issue (or a project as PIC). `name` is joined from
// users and is null once that user has been permanently deleted.
export const issueAssigneeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
});
export type IssueAssignee = z.infer<typeof issueAssigneeSchema>;

// Max users that may be attached to a single issue (same cap as project PICs).
export const MAX_ISSUE_ASSIGNEES = 20;

// Body for POST /api/projects/:id/issues (SUPER_ADMIN only). issue_date
// defaults to today server-side when omitted; assignee_ids defaults to none and
// send_email defaults to false (the UI turns it on by default).
export const issueCreateSchema = z.object({
  issue_text: z.string().trim().min(1, 'Issue text is required'),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD').optional(),
  assignee_ids: z
    .array(z.string().uuid())
    .max(MAX_ISSUE_ASSIGNEES, `At most ${MAX_ISSUE_ASSIGNEES} assignees per issue`)
    .default([]),
  send_email: z.boolean().default(false),
});
export type IssueCreate = z.infer<typeof issueCreateSchema>;

// One logged issue, joined to users for display names.
export const projectIssueEntrySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  issue_text: z.string(),
  issue_date: z.string(),
  assignees: z.array(issueAssigneeSchema),
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
