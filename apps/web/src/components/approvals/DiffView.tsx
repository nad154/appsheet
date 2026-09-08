import type { PendingEditDiff } from '@tracker/shared';
import { FIELD_LABELS, SECTION_OF, SECTION_ORDER } from '../../lib/projectFields';

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
