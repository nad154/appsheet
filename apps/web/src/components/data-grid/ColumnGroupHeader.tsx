import { flexRender } from '@tanstack/react-table';
import type { Header } from '@tanstack/react-table';
import type { CSSProperties } from 'react';
import type { Project } from '@tracker/shared';

// The leftmost column group ("Project Info") is sticky so it stays visible
// while the Customer/Vendor sections scroll horizontally.
export const STICKY_GROUP_ID = 'project_info';

// In the grid/flex layout used for virtualization, a group header spans the
// width of all its descendant leaf columns. This mirrors what colSpan would do
// in a normal <table> layout.
function headerWidth(header: Header<Project, unknown>): number {
  const leafs = header.getLeafHeaders();
  if (leafs.length > 0) {
    return leafs.reduce((sum, h) => sum + h.getSize(), 0);
  }
  return header.getSize();
}

interface ColumnGroupHeaderProps {
  header: Header<Project, unknown>;
  index: number;
}

export function ColumnGroupHeader({ header, index }: ColumnGroupHeaderProps) {
  const isSticky = index === 0 && header.column.parent?.id === STICKY_GROUP_ID;
  const width = headerWidth(header);

  const common: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    minWidth: width,
    width,
    flexShrink: 0,
    overflow: 'hidden',
  };

  const style: CSSProperties = isSticky
    ? { 
      ...common, 
      position: 'sticky', 
      left: 0, 
      zIndex: 40,
      backgroundColor: '#f9fafb',
      boxShadow: '2px 0 4px -2px rgba(0,0,0,0.08)',
     }
    : common;

  return (
    <th
      key={header.id}
      style={style}
      className="border-b border-r border-gray-200 bg-gray-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
    >
      <span className="block truncate">
        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
      </span>
    </th>
  );
}
