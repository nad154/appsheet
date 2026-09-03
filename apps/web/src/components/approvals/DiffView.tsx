import type { PendingEditDiff } from '@tracker/shared';

const FIELD_LABELS: Record<string, string> = {
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
  pic: 'PIC',
  issues: 'Issues',
};

const SECTION_OF: Record<string, string> = {
  folder_name: 'Project info',
  project_name: 'Project info',
  staff_assigned_id: 'Project info',
  drive_folder_id: 'Project info',
  current_stage: 'Project info',
  pic: 'Project info',
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

const SECTION_ORDER = ['Project info', 'Customer', 'Vendor'];

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function DiffView({ diff }: { diff: PendingEditDiff }) {
  if (diff.editType === 'CREATE') {
    return (
      <div className="text-sm">
        <p className="mb-3 text-amber-700">This is a proposed <strong>new</strong> project.</p>
        <table className="w-full border-collapse">
          <tbody>
            {Object.entries(diff.proposed).map(([key, value]) => {
              const label = FIELD_LABELS[key] ?? key;
              return (
                <tr key={key} className="border-b border-gray-100">
                  <td className="w-2/5 py-1.5 pr-2 text-gray-500">{label}</td>
                  <td className="py-1.5 font-medium text-green-700">+ {fmt(value)}</td>
                </tr>
              );
            })}
            {Object.keys(diff.proposed).length === 0 && (
              <tr><td className="py-1.5 text-gray-400">No fields proposed.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const fields = diff.changedFields.length > 0 ? diff.changedFields : Object.keys(diff.proposed);
  const conflictMap = new Map(diff.conflicts.map((c) => [c.field, c.pendingEditId]));

  const sections = SECTION_ORDER
    .map((section) => ({
      section,
      rows: fields.filter((f) => (SECTION_OF[f] ?? 'Other') === section),
    }))
    .filter((s) => s.rows.length > 0);

  return (
    <div className="text-sm">
      <p className="mb-3 text-gray-600">
        Editing existing project. <strong>{fields.length}</strong> field{fields.length === 1 ? '' : 's'} changed.
      </p>
      {sections.map(({ section, rows }) => (
        <div key={section} className="mb-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{section}</h4>
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((key) => {
                const label = FIELD_LABELS[key] ?? key;
                const conflict = conflictMap.get(key);
                return (
                  <tr key={key} className="border-b border-gray-100 align-top">
                    <td className="w-2/5 py-1.5 pr-2 text-gray-500">
                      {label}
                      {conflict && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          conflict
                        </span>
                      )}
                    </td>
                    <td className="w-1/5 py-1.5 pr-2 text-gray-400 line-through">{fmt(diff.current?.[key])}</td>
                    <td className="py-1.5 font-medium text-green-700">→ {fmt(diff.proposed[key])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {diff.conflicts.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          Other pending edits modify the same field on this project. Approving the latest edit will override
          earlier ones for the conflicting field.
        </p>
      )}
    </div>
  );
}
