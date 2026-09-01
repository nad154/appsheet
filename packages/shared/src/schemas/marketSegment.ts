import { z } from 'zod';

// Market segment row. Segments are soft-deleted via is_active (existing
// projects reference a segment by label, so hard deletes are not allowed).
export const marketSegmentSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});

export const marketSegmentCreateSchema = z.object({
  label: z.string().min(1),
  sort_order: z.number().int().optional(),
});

export const marketSegmentUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export type MarketSegment = z.infer<typeof marketSegmentSchema>;
export type MarketSegmentCreate = z.infer<typeof marketSegmentCreateSchema>;
export type MarketSegmentUpdate = z.infer<typeof marketSegmentUpdateSchema>;