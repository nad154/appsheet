import { z } from 'zod';
import { GOODS_OR_SERVICE } from '../roles.js';

// One vendor line on a project (project_vendors row). Holds everything that
// used to be the projects table's "Vendor Section" — aging/priority inputs
// included. vendor_name is joined in from vendors at query time (read-only).
// priority is derived from Aging + current thresholds — never stored, never
// submittable (hence omitted from create/update).
export const projectVendorSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  vendor_name: z.string(), // joined in, read-only
  vendor_type: z.enum(GOODS_OR_SERVICE).nullable().optional(),
  vendor_revenue: z.number().int().nullable().optional(),
  project_sent_date: z.string().nullable().optional(),
  project_finish_date: z.string().nullable().optional(),
  vendor_project_id: z.string().nullable().optional(),
  negotiation_date: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  document_sent_date: z.string().nullable().optional(),
  document_id: z.string().nullable().optional(),
  vendor_price: z.number().int().nullable().optional(),
  vendor_start_contract: z.string().nullable().optional(),
  vendor_end_contract: z.string().nullable().optional(),
  sort_order: z.number().int(),
  // Derived, never submitted — computed the same way Project.priority is today.
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
});

// What a caller may submit when adding a vendor line. project/id/vendor_name
// (joined) and priority (derived) are managed by the server.
export const projectVendorCreateSchema = projectVendorSchema.omit({
  id: true,
  project_id: true,
  vendor_name: true,
  priority: true,
});

// What a caller may submit when updating an existing vendor line.
export const projectVendorUpdateSchema = projectVendorCreateSchema.partial();

export type ProjectVendorLine = z.infer<typeof projectVendorSchema>;
export type ProjectVendorCreate = z.infer<typeof projectVendorCreateSchema>;
export type ProjectVendorUpdate = z.infer<typeof projectVendorUpdateSchema>;