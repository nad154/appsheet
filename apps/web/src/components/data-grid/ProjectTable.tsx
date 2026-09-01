import { useRef, useState, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Project } from '@tracker/shared';
import { ColumnGroupHeader } from './ColumnGroupHeader';
import { projectColumns, type ColumnMeta } from './columns';
import type { ToastVariant } from '../Toast';

interface ProjectColumnDef {
  columns?: ProjectColumnDef[];
  accessorKey?: string;
  meta?: ColumnMeta;
}

export type SortDir = 'asc' | 'desc';

export interface EditResult {
  ok: boolean;
  message?: string;
  pending?: boolean;
}

export type ActiveCell = { rowId: string; columnId: string } | null;

interface ProjectTableProps {
  rows: Project[];
  total: number;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: SortDir;
  isLoading: boolean;
  isError: boolean;
  pendingProjectIds?: Set<string>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sortBy: string, sortDir: SortDir) => void;
  onCellUpdate: (row: Project, field: string, value: unknown) => Promise<EditResult>;
  onNotice?: (message: string) => void;
}

const STICKY_GROUP_ID = 'project_info';

const Z = {
  thead: 20,
  stickyHeaderCol: 40,
  stickyBodyCol: 10,
};

function draftValue(row: Project, field: string): string {
  const v = (row as Record<string, unknown>)[field];
  return v === null || v === undefined ? '' : String(v);
}

function EditableCell({
  field,
  initialValue,
  editType,
  options,
  onCommit,
  onCancel,
}: {
  field: string;
  initialValue: string;
  editType?: string;
  options?: readonly string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);

  const commit = () => onCommit(draft);

  const cls =
    'w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';

  if (editType === 'select' && options?.length) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        className={cls}
        aria-label={`Edit ${field}`}
      >
        <option value="">–</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={editType === 'number' ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      className={cls}
      aria-label={`Edit ${field}`}
    />
  );
}

export function ProjectTable({
  rows,
  total,
  page,
  pageSize,
  sortBy,
  sortDir = 'asc',
  isLoading,
  isError,
  pendingProjectIds,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onCellUpdate,
  onNotice,
}: ProjectTableProps) {
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const table = useReactTable({
    data: rows,
    columns: projectColumns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      pendingProjectIds,
    } as { pendingProjectIds?: Set<string> },
  });

  const modelRows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const tableWidth = table.getTotalSize();

  const resetEditing = () => setActiveCell(null);

  const handleSortClick = (accessorKey: string | undefined) => {
    if (!accessorKey) return;
    resetEditing();
    const nextDir: SortDir = sortBy === accessorKey && sortDir === 'asc' ? 'desc' : 'asc';
    onSortChange(accessorKey, nextDir);
  };

  const handlePageChange = (next: number) => {
    resetEditing();
    onPageChange(next);
  };

  const handlePageSizeChange = (size: number) => {
    resetEditing();
    onPageSizeChange(size);
  };

  const commitCell = async (row: Project, field: string, value: string) => {
    const cellKey = `${row.id}_${field}`;
    setSavingCell(cellKey);
    const converted: unknown =
      field === 'current_stage' || field === 'service_or_goods' || field === 'vendor_type' || value === ''
        ? (value === '' ? null : value)
        : (() => {
            const meta = projectColumns
              .flatMap((g) => ((g as ProjectColumnDef).columns ?? []))
              .find((c) => c.accessorKey === field);
            const mt = (meta?.meta as ColumnMeta | undefined);
            if (mt?.editType === 'number' && value !== '') return Number(value);
            return value;
          })();

    const result = await onCellUpdate(row, field, converted);
    setSavingCell(null);
    if (result.ok) {
      setActiveCell(null);
      onNotice?.(result.pending ? 'Change submitted for approval.' : 'Saved.');
    } else {
      onNotice?.(result.message ?? 'Could not save change.');
      // Keep editor open so the user can correct.
    }
  };

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load projects. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Click any editable cell to change a value. STAFF edits are held for approval.</p>
        {isLoading && <p className="text-xs text-gray-400">Refreshing…</p>}
      </div>
      <div
        ref={parentRef}
        className="relative h-[65vh] overflow-auto rounded-md border border-gray-200"
        role="table"
        aria-label="Projects grid"
      >
        <table style={{ display: 'grid', width: tableWidth, minWidth: '100%' }}>
          <thead style={{ display: 'grid', position: 'sticky', top: 0, zIndex: Z.thead }}>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} style={{ display: 'flex' }}>
                {headerGroup.headers.map((header, index) => {
                  const isGroup = header.subHeaders.length > 0;
                  if (isGroup) {
                    return <ColumnGroupHeader key={header.id} header={header} index={index} />;
                  }
                  const accessorKey = (header.column.columnDef as { accessorKey?: string }).accessorKey;
                  const isSortable = typeof accessorKey === 'string' && header.column.getCanSort();
                  const isActiveSort = isSortable && accessorKey === sortBy;
                  const width = header.getSize();
                  const isStickyCol = index === 0 && header.column.parent?.id === STICKY_GROUP_ID;
                  // main table header 
                  return (
                    <th
                      key={header.id}
                      onClick={isSortable ? () => handleSortClick(accessorKey) : undefined}
                      aria-sort={isActiveSort ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="border-b border-r border-gray-200 bg-gray-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        minWidth: width,
                        width,
                        flexShrink: 0,
                        overflow: 'hidden',
                        position: isStickyCol ? 'sticky' : undefined,
                        left: isStickyCol ? 0 : undefined,
                        zIndex: isStickyCol ? Z.stickyHeaderCol : undefined,
                        backgroundColor: isStickyCol ? '#f9fafb' : undefined,
                        boxShadow: isStickyCol ? '2px 0 4px -2px rgba(0,0,0,0.08)' : undefined,
                        cursor: isSortable ? 'pointer' : undefined,
                      }}
                    >
                      <span className="flex-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {isSortable && (
                        <span className="ml-1 text-xs text-gray-400">
                          {isActiveSort ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody style={{ display: 'grid', height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rows.length === 0 && !isLoading && (
              <tr style={{ display: 'flex', width: '100%' }}>
                <td className="px-3 py-8 text-center text-sm text-gray-400" style={{ width: '100%' }}>
                  No projects to show.
                </td>
              </tr>
            )}
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = modelRows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    transform: `translateY(${virtualRow.start}px)`,
                    width: tableWidth,
                  }}
                >
                  {row.getVisibleCells().map((cell, index) => {
                    const width = cell.column.getSize();
                    const isStickyCol = index === 0 && cell.column.parent?.id === STICKY_GROUP_ID;
                    const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                    const field = cell.column.id;
                    const isEditing = !!activeCell && activeCell.rowId === row.id && activeCell.columnId === field;
                    const isSaving = savingCell === `${row.id}_${field}`;
                    const editable = !!meta?.editable;

                    let content: ReactNode;
                    if (isEditing) {
                      content = (
                        <div className="flex w-full items-center gap-1">
                          <span className="min-w-0 flex-1">
                            <EditableCell
                              field={field}
                              initialValue={draftValue(row.original, field)}
                              editType={meta?.editType}
                              options={meta?.options}
                              onCommit={(v) => commitCell(row.original, field, v)}
                              onCancel={() => setActiveCell(null)}
                            />
                          </span>
                          {isSaving && <span className="shrink-0 text-[10px] text-gray-400">saving…</span>}
                        </div>
                      );
                    } else if (editable) {
                      content = (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCell({ rowId: row.id, columnId: field });
                          }}
                          className="w-full cursor-text rounded px-0 text-left hover:outline hover:outline-1 hover:outline-blue-300"
                          title={`Edit ${field}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </button>
                      );
                    } else {
                      content = flexRender(cell.column.columnDef.cell, cell.getContext());
                    }

                    return (
                      <td
                        key={cell.id}
                        className="px-3 py-2 text-gray-700"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          minWidth: width,
                          width,
                          flexShrink: 0,
                          position: isStickyCol ? 'sticky' : undefined,
                          left: isStickyCol ? 0 : undefined,
                          zIndex: isStickyCol ? Z.stickyBodyCol : undefined,
                          background: isStickyCol ? '#fff' : undefined,
                          boxShadow: isStickyCol ? '2px 0 4px -2px rgba(0,0,0,0.06)' : undefined,
                          cursor: editable ? 'text' : undefined,
                        }}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className="rounded-md border px-2 py-1"
            aria-label="Rows per page"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>{total} project(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
