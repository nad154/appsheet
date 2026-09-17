import { z } from 'zod';
import { GOODS_OR_SERVICE, PROJECT_STAGES } from '../roles.js';
import { projectVendorSchema } from './projectVendor.js';

// A full project row. Most fields are nullable (a project may be partly
// populated). Field names mirror the `projects` table columns in migrate.ts
// (snake_case). The API contract uses these exact keys.
export const projectSchema = z.object({
  id: z.string().uuid(),
  folder_name: z.string().nullable().optional(),
  project_name: z.string().min(1),
  staff_assigned_name: z.string().nullable().optional(),
  staff_assigned_id: z.string().uuid().nullable().optional(),
  drive_folder_id: z.string().nullable().optional(),

  // Customer section. customer_id is the FK (1:1 per project); customer_name is
  // joined in from customers at query time and is read-only.
  customer_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  market_segment: z.string().nullable().optional(),
  service_or_goods: z.enum(GOODS_OR_SERVICE).nullable().optional(),
  date_customer_received_doc1: z.string().nullable().optional(),
  date_customer_received_doc2: z.string().nullable().optional(),
  doc2_number_id: z.string().nullable().optional(),
  customer_price: z.number().int().nullable().optional(),
  customer_start_contract: z.string().nullable().optional(),
  customer_end_contract: z.string().nullable().optional(),
  current_stage: z.enum(PROJECT_STAGES).default('on_progress'),

  // PIC / Issues
  pic_id: z.string().uuid().nullable().optional(),
  pic_name: z.string().nullable().optional(),
  issues: z.string().nullable().optional(),

  // Derived by the server from Aging + current thresholds — never stored and
  // never submittable (hence omitted from the create/update schemas below).
  // NOTE: with multi-vendor projects, priority is computed per vendor line and
  // lives on vendors[].priority. This project-level key is retained for type
  // compatibility but the server no longer populates it.
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),

  // Embedded vendor lines (planning_customers_vendors §3.2). The frontend
  // builds its display rows from this array. Never submitted via the projects
  // PATCH — vendor-line changes go through /api/projects/:id/vendors/*.
  vendors: z.array(projectVendorSchema).optional(),

  // Latest STAFF update-progress note + whether SUPER_ADMIN has seen it yet.
  // Derived from project_updates at query time — never submitted by the client.
  update_progress: z.string().nullable().optional(),
  has_unread_update: z.boolean().optional(),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;

// Fields a caller may submit when creating or editing a project. Id and
// timestamps are managed by the server. priority, customer_name (joined) and
// the embedded vendors array are deliberately excluded — priority is always
// derived server-side, and vendor lines are managed via dedicated endpoints.
export const projectCreateSchema = projectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  staff_assigned_name: true,
  pic_name: true,
  priority: true,
  update_progress: true,
  has_unread_update: true,
  customer_name: true,
  vendors: true,
});

export const projectUpdateSchema = projectCreateSchema.partial();

export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

// Paginated list response returned by GET /api/projects.
export const projectListSchema = z.object({
  rows: z.array(projectSchema),
  total: z.number().int(),
  total_pages: z.number().int(),
  total_lines: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
});

export type ProjectList = z.infer<typeof projectListSchema>;