import { z } from 'zod';
import { ROLES } from '../roles.js';

// Full internal user record (server-side only). Never returned through the
// API and never exported to users.parquet.
export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  password_hash: z.string().min(1),
  role: z.enum(ROLES),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
});

// Shape returned by the API and included in users.parquet (no password_hash).
export const publicUserSchema = userSchema.omit({ password_hash: true });
export type User = z.infer<typeof userSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;

// Payload for creating/updating a user via the settings API.
export const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

export const userUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
});

// Impact of permanently deleting a user, shown in the Settings confirmation
// modal before the delete. Project assignments are intentionally left in place
// (the id keeps pointing at the removed user) so the grid can flag those rows
// as "(deleted user)" until a SUPER_ADMIN reassigns them.
export const userUsageSchema = z.object({
  projects_assigned: z.number().int().nonnegative(),
  projects_pic: z.number().int().nonnegative(),
  issue_assignments: z.number().int().nonnegative(),
});

export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
export type UserUsage = z.infer<typeof userUsageSchema>;
