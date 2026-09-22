import { flexRender } from '@tanstack/react-table';
import type { Header } from '@tanstack/react-table';
import type { CSSProperties } from 'react';
import type { DisplayRow } from './columns';

// Section header tints, keyed by the column-group ids defined in columns.tsx:
// the Customer section renders green, the Vendor section renders purple.
// project_info — and any other unstyled group — keeps the neutral gray.
const GROUP_HEADER_TINT: Record<string, string> = {
  customer: 'bg-green-200 text-green-800',
  vendor: 'bg-purple-200 text-purple-800',
};

interface ColumnGroupHeaderProps {
  header: Header<DisplayRow, unknown>;
  stickySet: Set<string>;
  stickyLeftOffsets: Map<string, number>;
  runEndIds: Set<string>;
}

// The group header row is split into segments (contiguous runs of same-
// stickiness leaf columns) so sticky parts stay put while the rest of the group
// scrolls (D4). The group label renders in the widest segment.
export function ColumnGroupHeader({
  header,
  stickySet,
  stickyLeftOffsets,
  runEndIds,
}: ColumnGroupHeaderProps) {
  const leaves = header.subHeaders; // two-level header: children are leaf headers

  // 1. Split into contiguous runs of same stickiness.
  const segments: { sticky: boolean; leaves: typeof leaves; width: number }[] = [];
  for (const leaf of leaves) {
    const sticky = stickySet.has(leaf.column.id);
    const last = segments[segments.length - 1];
    if (last && last.sticky === sticky) {
      last.leaves.push(leaf);
      last.width += leaf.getSize();
    } else {
      segments.push({ sticky, leaves: [leaf], width: leaf.getSize() });
    }
  }

  // 2. Label goes in the widest segment (first wins ties).
  const labelIdx = segments.reduce((best, s, i, arr) => (s.width > arr[best].width ? i : best), 0);
  const tint = GROUP_HEADER_TINT[header.column.id] ?? 'bg-gray-100 text-gray-600';

  return (
    <>
      {segments.map((seg, i) => {
        const first = seg.leaves[0];
        const lastLeaf = seg.leaves[seg.leaves.length - 1];
        const style: CSSProperties = {
          gridColumn: `span ${seg.leaves.length} / span ${seg.leaves.length}`,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          ...(seg.sticky
            ? {
                position: 'sticky',
                left: stickyLeftOffsets.get(first.column.id) ?? 0,
                zIndex: 40,
                boxShadow: runEndIds.has(lastLeaf.column.id)
                  ? '2px 0 4px -2px rgba(0,0,0,0.08)'
                  : undefined,
              }
            : {}),
        };
        return (
          <div
            key={`${header.id}-${i}`}
            role="columnheader"
            style={style}
            className={`border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${tint}`}
          >
            <span className="block truncate">
              {i === labelIdx && !header.isPlaceholder
                ? flexRender(header.column.columnDef.header, header.getContext())
                : null}
            </span>
          </div>
        );
      })}
    </>
  );
}