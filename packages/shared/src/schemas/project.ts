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

  // Responsible PICs (0..20). Every entry is an active STAFF or SUPER_ADMIN
  // user; holding a PIC row grants that user visibility/edits on the project,
  // and only SUPER_ADMIN may change the set. `name` is joined from users at
  // query time and is null once the user is permanently deleted (dangling row).
  pics: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().nullable(),
      }),
    )
    .optional(),
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

  // Latest logged issue's date + assignees, derived from project_issues /
  // project_issue_assignees at query time — never submitted by the client. The
  // latest issue TEXT lives on projects.issues itself (denormalized, kept in
  // sync by the add-issue write). An assignee's `name` is null once the user is
  // permanently deleted, so the grid can flag it instead of rendering a blank.
  latest_issue_date: z.string().nullable().optional(),
  latest_issue_assignees: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().nullable(),
      }),
    )
    .optional(),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof projectSchema>;

// Fields a caller may submit when creating or editing a project. Id and
// timestamps are managed by the server. priority, customer_name (joined) and
// the embedded vendors array are deliberately excluded — priority is always
// derived server-side, and vendor lines are managed via dedicated endpoints.
export const projectWriteSchema = projectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  staff_assigned_name: true,
  pics: true,
  priority: true,
  update_progress: true,
  has_unread_update: true,
  latest_issue_date: true,
  latest_issue_assignees: true,
  customer_name: true,
  vendors: true,
  // issues is SUPER_ADMIN-only and only ever written through the add-issue
  // endpoint (POST /api/projects/:id/issues) — never submittable via create/update.
  issues: true,
});

// Responsible PIC ids are a full replacement set on update and the initial set
// on create. SUPER_ADMIN-only — the server rejects a STAFF payload carrying any.
// Kept out of projectWriteSchema so create can default to [] while update stays
// absent when the caller did not touch PICs (an omitted key must not wipe them).
export const projectCreateSchema = projectWriteSchema.extend({
  pic_ids: z.array(z.string().uuid()).max(20, 'At most 20 PICs per project').default([]),
});

export const projectUpdateSchema = projectWriteSchema.partial().extend({
  /** SUPER_ADMIN may set a custom creation date; server enforces role. */
  created_at: z.string().optional(),
  pic_ids: z.array(z.string().uuid()).max(20, 'At most 20 PICs per project').optional(),
});

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