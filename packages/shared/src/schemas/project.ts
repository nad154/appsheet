import { z } from 'zod';
import { GOODS_OR_SERVICE, PROJECT_STAGES } from '../roles.js';

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

  // Customer section
  customer_name: z.string().nullable().optional(),
  market_segment: z.string().nullable().optional(),
  service_or_goods: z.enum(GOODS_OR_SERVICE).nullable().optional(),
  date_customer_received_doc1: z.string().nullable().optional(),
  date_customer_received_doc2: z.string().nullable().optional(),
  doc2_number_id: z.string().nullable().optional(),
  customer_price: z.number().int().nullable().optional(),
  customer_start_contract: z.string().nullable().optional(),
  customer_end_contract: z.string().nullable().optional(),

  // Vendor section
  vendor_name: z.string().nullable().optional(),
  vendor_revenue: z.number().int().nullable().optional(),
  vendor_type: z.enum(GOODS_OR_SERVICE).nullable().optional(),
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
  current_stage: z.enum(PROJECT_STAGES).default('on_progress'),

  // PIC / Issues
  pic: z.string().nullable().optional(),
  issues: z.string().nullable().optional(),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;

// Fields a caller may submit when creating or editing a project. Id and
// timestamps are managed by the server.
export const projectCreateSchema = projectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  staff_assigned_name: true, 
});

export const projectUpdateSchema = projectCreateSchema.partial();

export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

// Paginated list response returned by GET /api/projects.
export const projectListSchema = z.object({
  rows: z.array(projectSchema),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
});

export type ProjectList = z.infer<typeof projectListSchema>;
