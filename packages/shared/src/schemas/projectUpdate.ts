import { z } from 'zod';

// One changed field, captured as an old/new pair at the moment of the update.
export const projectUpdateFieldDiffSchema = z.object({
  old: z.unknown(),
  new: z.unknown(),
});

export const projectUpdateEntrySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  staff_name: z.string(),
  changes: z.record(z.string(), projectUpdateFieldDiffSchema),
  update_progress: z.string(),
  is_read: z.boolean(),
  created_at: z.string().datetime(),
});
export type ProjectUpdateEntry = z.infer<typeof projectUpdateEntrySchema>;

// GET /api/projects/:id/updates response.
export const projectUpdateHistorySchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string(),
  entries: z.array(projectUpdateEntrySchema),
});
export type ProjectUpdateHistory = z.infer<typeof projectUpdateHistorySchema>;

// Required field bundled into a STAFF PATCH /api/projects/:id body, alongside
// the normal changed project fields. Stripped out server-side before the rest
// of the body is validated against projectUpdateSchema.
export const updateProgressFieldSchema = z.object({
  update_progress: z.string().trim().min(1, 'Update progress is required'),
});