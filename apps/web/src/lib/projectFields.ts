import { GOODS_OR_SERVICE, PROJECT_STAGES } from '@tracker/shared';

// Widget kind per editable project field. Shared by the row-edit modal (which
// renders every field of a row) and mirrored by ProjectTable.tsx's inline
// EditableCell primitives.
export type EditType = 'text' | 'number' | 'select' | 'date' | 'textarea' | 'user';

// Human labels for project fields, used by both the approvals diff view and the
// row-edit modal, so the two never disagree on how a field is named.
export const FIELD_LABELS: Record<string, string> = {
  folder_name: 'Folder',
  project_name: 'Project name',
  staff_assigned_id: 'Assigned staff',
  drive_folder_id: 'Drive folder',
  customer_name: 'Customer name',
  market_segment: 'Market segment',
  service_or_goods: 'Service / goods',
  date_customer_received_doc1: 'Customer doc received (1)',
  date_customer_received_doc2: 'Customer doc received (2)',
  doc2_number_id: 'Doc 2 number',
  customer_price: 'Customer price',
  customer_start_contract: 'Customer contract start',
  customer_end_contract: 'Customer contract end',
  vendor_name: 'Vendor name',
  vendor_revenue: 'Vendor revenue',
  vendor_type: 'Vendor type',
  project_sent_date: 'Project sent date',
  project_finish_date: 'Project finish date',
  vendor_project_id: 'Vendor project ID',
  negotiation_date: 'Negotiation date',
  approval_date: 'Approval date',
  document_sent_date: 'Document sent date',
  document_id: 'Document ID',
  vendor_price: 'Vendor price',
  vendor_start_contract: 'Vendor contract start',
  vendor_end_contract: 'Vendor contract end',
  current_stage: 'Stage',
  pic_id: 'PIC',
  issues: 'Issues',
};

// Which modal/diff section each field belongs to. Any field not listed here
// falls into an implicit "Other" bucket.
export const SECTION_OF: Record<string, string> = {
  folder_name: 'Project info',
  project_name: 'Project info',
  staff_assigned_id: 'Project info',
  drive_folder_id: 'Project info',
  current_stage: 'Project info',
  pic_id: 'Project info',
  customer_name: 'Customer',
  market_segment: 'Customer',
  service_or_goods: 'Customer',
  date_customer_received_doc1: 'Customer',
  date_customer_received_doc2: 'Customer',
  doc2_number_id: 'Customer',
  customer_price: 'Customer',
  customer_start_contract: 'Customer',
  customer_end_contract: 'Customer',
  vendor_name: 'Vendor',
  vendor_revenue: 'Vendor',
  vendor_type: 'Vendor',
  project_sent_date: 'Vendor',
  project_finish_date: 'Vendor',
  vendor_project_id: 'Vendor',
  negotiation_date: 'Vendor',
  approval_date: 'Vendor',
  document_sent_date: 'Vendor',
  document_id: 'Vendor',
  vendor_price: 'Vendor',
  vendor_start_contract: 'Vendor',
  vendor_end_contract: 'Vendor',
  issues: 'Vendor',
};

export const SECTION_ORDER = ['Project info', 'Customer', 'Vendor'];

// Fields that hold a numeric value in the DB/API. The modal keeps drafts as
// strings and converts these back to numbers (or null) on save.
export const NUMBER_FIELDS = new Set(['customer_price', 'vendor_revenue', 'vendor_price']);

// Widget kind for every editable field — the modal builds its inputs from this.
export const FIELD_TYPES: Record<string, EditType> = {
  folder_name: 'text',
  project_name: 'text',
  staff_assigned_id: 'user',
  current_stage: 'select',
  pic_id: 'user',
  customer_name: 'text',
  market_segment: 'text',
  service_or_goods: 'select',
  date_customer_received_doc1: 'date',
  date_customer_received_doc2: 'date',
  doc2_number_id: 'text',
  customer_price: 'number',
  customer_start_contract: 'date',
  customer_end_contract: 'date',
  vendor_name: 'text',
  vendor_revenue: 'number',
  vendor_type: 'select',
  project_sent_date: 'date',
  project_finish_date: 'date',
  vendor_project_id: 'text',
  negotiation_date: 'date',
  approval_date: 'date',
  document_sent_date: 'date',
  document_id: 'text',
  vendor_price: 'number',
  vendor_start_contract: 'date',
  vendor_end_contract: 'date',
  issues: 'textarea',
};

// Allowed values for select-type fields, in the modal and (potentially) other
// consumers. Mirrors the options wired into the grid columns in columns.tsx.
export const FIELD_SELECT_OPTIONS: Record<string, readonly string[]> = {
  current_stage: PROJECT_STAGES,
  service_or_goods: GOODS_OR_SERVICE,
  vendor_type: GOODS_OR_SERVICE,
};