import { z } from 'zod';

export const PENDING_EDIT_TYPES = ['CREATE', 'UPDATE'] as const;
export const PENDING_EDIT_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type PendingEditType = (typeof PENDING_EDIT_TYPES)[number];
export type PendingEditStatus = (typeof PENDING_EDIT_STATUSES)[number];

export const pendingEditSchema = z.object({
  id: z.string().uuid(),
  // Null when this is a proposed NEW row (edit_type = 'CREATE').
  project_id: z.string().uuid().nullable(),
  requested_by: z.string().uuid(),
  edit_type: z.enum(PENDING_EDIT_TYPES),
  // JSON map of changed field -> proposed value (only the changed fields).
  changes_json: z.record(z.string(), z.unknown()),
  status: z.enum(PENDING_EDIT_STATUSES),
  reviewed_by: z.string().uuid().nullable().optional(),
  review_note: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  reviewed_at: z.string().datetime().nullable().optional(),
});

export type PendingEdit = z.infer<typeof pendingEditSchema>;

// Shape returned by the diff endpoint:
// current = the live project row (or null for a CREATE), proposed = the target
// state, changedFields = list of field names that differ.
export const pendingEditDiffSchema = z.object({
  editId: z.string().uuid(),
  editType: z.enum(PENDING_EDIT_TYPES),
  current: z.record(z.string(), z.unknown()).nullable(),
  proposed: z.record(z.string(), z.unknown()),
  changedFields: z.array(z.string()),
  // Fields modified by another pending edit on the same project.
  conflicts: z.array(
    z.object({
      field: z.string(),
      pendingEditId: z.string().uuid(),
    }),
  ),
});

export type PendingEditDiff = z.infer<typeof pendingEditDiffSchema>;
