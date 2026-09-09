import { flexRender } from '@tanstack/react-table';
import type { Header } from '@tanstack/react-table';
import type { CSSProperties } from 'react';
import type { Project } from '@tracker/shared';

// The leftmost column group ("Project Info") is sticky so it stays visible
// while the Customer/Vendor sections scroll horizontally.
export const STICKY_GROUP_ID = 'project_info';

function headerWidth(header: Header<Project, unknown>): number {
  const leafs = header.getLeafHeaders();
  if (leafs.length > 0) {
    return leafs.reduce((sum, h) => sum + h.getSize(), 0);
  }
  return header.getSize();
}

interface ColumnGroupHeaderProps {
  header: Header<Project, unknown>;
}

// Section header tints, keyed by the column-group ids defined in columns.tsx:
// the Customer section renders green, the Vendor section renders purple.
// Non-sticky (scrollable) groups only; the sticky Project Info band keeps its
// neutral gray so it doesn't fight with the colored sections beside it.
const GROUP_HEADER_TINT: Record<string, string> = {
  customer: 'bg-green-200 text-green-800',
  vendor: 'bg-purple-200 text-purple-800',
};

export function ColumnGroupHeader({ header }: ColumnGroupHeaderProps) {
  const isSticky = header.column.id === STICKY_GROUP_ID;
  // const width = headerWidth(header);

  const style: CSSProperties = {
    gridColumn: `span ${header.colSpan} / span ${header.colSpan}`,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    ...(isSticky
      ? {
          position: 'sticky',
          left: 0,
          zIndex: 40,
          backgroundColor: '#f9fafb',
          boxShadow: '2px 0 4px -2px rgba(0,0,0,0.08)',
        }
      : {}),
  };

  return (
      <div
        key={header.id}
        role="columnheader"
        style={style}
        className={`border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${GROUP_HEADER_TINT[header.column.id] ?? 'bg-gray-100 text-gray-600'}`}
      >
        <span className="block truncate">
          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
        </span>
      </div>
  );
}
