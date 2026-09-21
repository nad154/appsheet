import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Project, ProjectVendorLine } from '@tracker/shared';
import { ColumnGroupHeader } from './ColumnGroupHeader';
import { buildProjectColumns, type ColumnMeta, type DisplayRow } from './columns';
import { EditProjectModal } from './EditProjectModal';
import { UpdateHistoryModal } from './UpdateHistoryModal';
import { IssuesModal } from './IssuesModal';
import { StageConfirmModal } from './StageConfirmModal';
import type { AssignableUser } from '../../hooks/useProjects';
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
}

export type ActiveCell = { rowId: string; columnId: string } | null;

interface ProjectTableProps {
  rows: Project[];
  total: number;
  totalPages: number;
  totalLines: number;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: SortDir;
  isLoading: boolean;
  isError: boolean;
  users?: AssignableUser[];
  isAdmin?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sortBy: string | undefined, sortDir: SortDir | undefined) => void;
  onRowUpdate: (row: Project, changes: Record<string, unknown>) => Promise<EditResult>;
  onNotice?: (message: string, variant?: ToastVariant) => void;
  // Id of a project to scroll to and briefly flash (set when arriving from a
  // dashboard drill-down click).
  highlightedRowId?: string | null;
  onHighlightDone?: () => void;
}

const STICKY_GROUP_ID = 'project_info';

// Leaf-header tints, keyed by the parent column-group id from columns.tsx:
// headers under the Customer group render light green, under Vendor light
// purple (lighter than the group bands). The sticky Project Info group keeps
// its neutral gray.
const LEAF_HEADER_TINT: Record<string, string> = {
  customer: 'bg-green-100 text-green-700',
  vendor: 'bg-purple-100 text-purple-700',
};

const Z = {
  thead: 20,
  stickyHeaderCol: 40,
  stickyBodyCol: 10,
};

// Grid display rows: the first row of a project holds its group-header cells,
// and every project_vendors line renders as its own continuation row. A project
// with zero lines renders exactly one blank-vendor row (plan §3.1).
function flattenRows(rows: Project[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  // Page-relative project ordinal for the number column: every vendor line of a
  // project shares its project's number, and the counter resets each page.
  let projectIndex = 0;
  for (const project of rows) {
    projectIndex += 1;
    const vendors: ProjectVendorLine[] = project.vendors ?? [];
    if (vendors.length > 0) {
      vendors.forEach((vendor, i) => {
        out.push({ project, vendor, isFirstOfGroup: i === 0, rowKey: `${project.id}:${vendor.id}`, index: projectIndex });
      });
    } else {
      out.push({ project, vendor: null, isFirstOfGroup: true, rowKey: `${project.id}:none`, index: projectIndex });
    }
  }
  return out;
}

function draftValue(row: Project, field: string): string {
  const v = (row as Record<string, unknown>)[field];
  return v === null || v === undefined ? '' : String(v);
}

function EditableCell({
  field,
  initialValue,
  editType,
  options,
  users,
  onCommit,
  onCancel,
}: {
  field: string;
  initialValue: string;
  editType?: string;
  options?: readonly string[];
  users?: AssignableUser[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);

  const commit = () => onCommit(draft);

  const cls =
    'w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';
  
  if (editType === 'date') {
    return (
      <input
        autoFocus
        type="date"
        value={draft.length > 10 ? draft.slice(0, 10) : draft}
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

  if (editType === 'user') {
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
        {(users ?? []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    );
  }

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

  if (editType === 'textarea') {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
          if (e.key === 'Escape') onCancel();
        }}
        rows={3}
        className={cls}
        aria-label={`Edit ${field}`}
      />
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
  totalPages,
  totalLines,
  page,
  pageSize,
  sortBy,
  sortDir = 'asc',
  isLoading,
  isError,
  users,
  isAdmin,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onRowUpdate,
  onNotice,
  highlightedRowId,
  onHighlightDone,
}: ProjectTableProps) {
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [editModalRow, setEditModalRow] = useState<Project | null>(null);
  const [historyRow, setHistoryRow] = useState<Project | null>(null);
  const [issuesRow, setIssuesRow] = useState<Project | null>(null);
  const [stageConfirmRow, setStageConfirmRow] = useState<Project | null>(null);
  const [flashActive, setFlashActive] = useState(false);

  // Column definitions are rebuilt per-role: STAFF never gets any inline
  // editable cell (row-click opens the modal instead), and SUPER_ADMIN gets the
  // clickable Update Progress and Issues cells wired to their modals.
  const columns = useMemo(
    () =>
      buildProjectColumns({
        isAdmin: !!isAdmin,
        onOpenHistory: setHistoryRow,
        onOpenIssues: setIssuesRow,
        onRequestFinish: setStageConfirmRow,
      }),
    [isAdmin],
  );

  const displayRows = useMemo(() => flattenRows(rows), [rows]);

  const table = useReactTable({
    data: displayRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const modelRows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);

  const leafHeaders = table.getHeaderGroups().at(-1)?.headers ?? [];
  const gridTemplateColumns = leafHeaders.map((h) => `${h.getSize()}px`).join(' ');

  const stickyColIds: string[] = [];
  let stickyAcc = 0;
  const stickyLeftOffsets = new Map<string, number>();
  for (const h of leafHeaders) {
    if (h.column.parent?.id === STICKY_GROUP_ID) {
      stickyLeftOffsets.set(h.column.id, stickyAcc);
      stickyColIds.push(h.column.id);
      stickyAcc += h.getSize();
    }
  }
  const lastStickyColId = stickyColIds[stickyColIds.length - 1];

  const rowVirtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  // Drill-down arrival: once the highlighted project is present in the loaded
  // page, scroll its group-header row into view and start the flash. Re-runs as
  // the target page's data arrives; the row handles the rest via flashActive.
  const scrolledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightedRowId) {
      setFlashActive(false);
      return;
    }
    if (scrolledForRef.current === highlightedRowId) return;
    const idx = modelRows.findIndex((r) => r.original.isFirstOfGroup && r.original.project.id === highlightedRowId);
    if (idx === -1) return;
    scrolledForRef.current = highlightedRowId;
    setFlashActive(true);
    requestAnimationFrame(() => {
      // Center the highlighted row without depending on the virtualizer's
      // measurement timing (a fresh mount may not have measurements yet).
      const el = parentRef.current;
      if (el) {
        const rowOffset = idx * 44; // matches the virtualizer estimateSize
        el.scrollTop = Math.max(0, rowOffset - Math.floor(el.clientHeight / 2) + 22);
      }
    });
  }, [highlightedRowId, modelRows, rowVirtualizer]);

  // End the flash after ~1.8s, then tell the page to clear the highlight.
  useEffect(() => {
    if (!flashActive) return;
    const t = window.setTimeout(() => {
      setFlashActive(false);
      onHighlightDone?.();
    }, 1800);
    return () => window.clearTimeout(t);
  }, [flashActive, onHighlightDone]);

  const tableWidth = table.getTotalSize();

  const resetEditing = () => setActiveCell(null);

  const handleSortClick = (columnId: string) => {
    resetEditing();
    if (sortBy !== columnId) {
      onSortChange(columnId, 'asc');
    } else if (sortDir === 'asc') {
      onSortChange(columnId, 'desc');
    } else {
      // Third click on the same column: release back to the app default.
      onSortChange(undefined, undefined);
    }
  };

  const handlePageChange = (next: number) => {
    resetEditing();
    onPageChange(next);
  };

  const handlePageSizeChange = (size: number) => {
    resetEditing();
    onPageSizeChange(size);
  };

  const commitCell = async (rowId: string, row: DisplayRow, field: string, value: string) => {
    const project = row.project;
    const cellKey = `${rowId}_${field}`;
    setSavingCell(cellKey);
    const meta = columns
      .flatMap((g) => ((g as ProjectColumnDef).columns ?? []))
      .find((c) => c.accessorKey === field);
    const mt = (meta?.meta as ColumnMeta | undefined);
    const converted: unknown = value === '' ? null : mt?.editType === 'number' ? Number(value) : value;

    const result = await onRowUpdate(project, { [field]: converted });
    setSavingCell(null);
    if (result.ok) {
      setActiveCell(null);
      onNotice?.('Saved.');
    } else {
      onNotice?.(result.message ?? 'Could not save change.');
      // Keep editor open so the user can correct.
    }
  };

  const commitStageFinish = async (project: Project) => {
    const result = await onRowUpdate(project, { current_stage: 'finish' });
    setStageConfirmRow(null);
    if (result.ok) {
      onNotice?.('Stage set to Finish.', 'success');
    } else {
      onNotice?.(result.message ?? 'Could not set the stage to Finish.');
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
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {isAdmin
            ? 'Click any editable cell or the pencil to change a value directly.'
            : 'Click any row to open the edit form — changes apply immediately.'}
        </p>
        {isLoading && <p className="text-xs text-gray-400">Refreshing…</p>}
      </div>
      <div
        ref={parentRef}
        className="relative min-h-0 flex-1 overflow-auto rounded-md border border-gray-200"
        role="table"
        aria-label="Projects grid"
      >
        <div style={{ display: 'grid', width: tableWidth, minWidth: '100%' }}>
          <div role="rowgroup" style={{ display: 'grid', position: 'sticky', top: 0, zIndex: Z.thead }}>
            {table.getHeaderGroups().map((headerGroup) => (
              <div key={headerGroup.id} 
              role="row"
              style={{ display: 'grid', gridTemplateColumns, width: tableWidth }}>
                {headerGroup.headers.map((header) => {
                  const isGroup = header.subHeaders.length > 0;
                  if (isGroup) {
                    return <ColumnGroupHeader key={header.id} header={header} />;
                  }
                  const columnId = header.column.id;
                  const isSortable = header.column.getCanSort();
                  const isActiveSort = isSortable && columnId === sortBy;
                  const isStickyCol = header.column.parent?.id === STICKY_GROUP_ID;
                  const stickyLeft = isStickyCol ? stickyLeftOffsets.get(header.column.id) ?? 0 : undefined;
                  const isLastStickyCol = header.column.id === lastStickyColId;
                  const leafTint = LEAF_HEADER_TINT[header.column.parent?.id ?? ''] ?? '';
                  // main table header 
                  return (
                    <div
                      key={header.id}
                      role="columnheader"
                      onClick={isSortable ? () => handleSortClick(columnId) : undefined}
                      aria-sort={isActiveSort ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${leafTint || 'bg-gray-100 text-gray-600'}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                        position: isStickyCol ? 'sticky' : undefined,
                        left: isStickyCol ? stickyLeft : undefined,
                        zIndex: isStickyCol ? Z.stickyHeaderCol : undefined,
                        backgroundColor: isStickyCol ? '#f9fafb' : undefined,
                        boxShadow: isLastStickyCol ? '2px 0 4px -2px rgba(0,0,0,0.08)' : undefined,
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
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div role="rowgroup" style={{ display: 'grid', height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rows.length === 0 && !isLoading && (
              <div role="row" style={{ display: 'flex', width: '100%' }}>
                <div role="cell" className="px-3 py-8 text-center text-sm text-gray-400" style={{ width: '100%' }}>
                  No projects to show.
                </div>
              </div>
            )}
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = modelRows[virtualRow.index];
              const { project, isFirstOfGroup } = row.original;
              const isContinuation = !isFirstOfGroup;
              const isHighlighted =
                flashActive && isFirstOfGroup && row.original.project.id === highlightedRowId;
              return (
                <div
                  key={row.id}
                  role="row"
                  data-testid={isHighlighted ? 'highlighted-row' : undefined}
                  onClick={!isAdmin && isFirstOfGroup ? () => setEditModalRow(project) : undefined}
                  className={`border-b border-gray-100 ${isContinuation ? 'bg-gray-50' : ''} hover:bg-gray-50 ${
                    isHighlighted ? 'animate-[row-flash_1.2s_ease-in-out]' : ''
                  } ${!isAdmin ? 'cursor-pointer' : ''}`}
                  style={{
                    display: 'grid', 
                    gridTemplateColumns, 
                    position: 'absolute', 
                    transform: `translateY(${virtualRow.start}px)`, 
                    width: tableWidth
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const isStickyCol = cell.column.parent?.id === STICKY_GROUP_ID;
                    const stickyLeft = isStickyCol ? stickyLeftOffsets.get(cell.column.id) ?? 0 : undefined;
                    const isLastStickyCol = cell.column.id === lastStickyColId;
                    const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                    const field = cell.column.id;
                    const isEditing = !!activeCell && activeCell.rowId === row.id && activeCell.columnId === field;
                    const isSaving = savingCell === `${row.id}_${field}`;
                    // Project-level cells are editable only on the group-header
                    // row; vendor-line cells are modal-only (never editable).
                    const editable = isAdmin && !!meta?.editable && isFirstOfGroup;

                    let content: ReactNode;
                    if (isEditing && isFirstOfGroup) {
                      content = (
                        <div className="flex w-full items-center gap-1">
                          <span className="min-w-0 flex-1">
                            <EditableCell
                              field={field}
                              initialValue={draftValue(project, field)}
                              editType={meta?.editType}
                              options={meta?.options}
                              users={users}
                              onCommit={(v) => commitCell(row.id, row.original, field, v)}
                              onCancel={() => setActiveCell(null)}
                            />
                          </span>
                          {isSaving && <span className="shrink-0 text-[10px] text-gray-400">saving…</span>}
                        </div>
                      );
                    } else {
                      const rendered = editable ? (
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
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      );

                      // The project-name cell hosts the row-edit affordance: a
                      // pencil revealed on row hover, opening the full-field modal.
                      if (field === 'project_name' && isFirstOfGroup) {
                        content = (
                          <div className="group relative flex w-full items-center">
                            <span className="min-w-0 flex-1">{rendered}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditModalRow(project);
                              }}
                              className="ml-1 hidden shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 group-hover:inline-flex"
                              aria-label={`Edit ${project.project_name}`}
                              title="Edit project"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                            </button>
                          </div>
                        );
                      } else {
                        content = rendered;
                      }
                    }

                    return (
                      <div
                        key={cell.id}
                        role="cell"
                        className={`px-3 py-2 text-gray-700 ${
                          isStickyCol && isHighlighted
                            ? 'animate-[row-flash-sticky_1.2s_ease-in-out]'
                            : ''
                        }`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          overflow: 'hidden',
                          position: isStickyCol ? 'sticky' : undefined,
                          left: isStickyCol ? stickyLeft : undefined,
                          zIndex: isStickyCol ? Z.stickyBodyCol : undefined,
                          background: isStickyCol ? (isContinuation ? '#f9fafb' : '#fff') : undefined,
                          boxShadow: isLastStickyCol ? '2px 0 4px -2px rgba(0,0,0,0.06)' : undefined,
                          cursor: editable ? 'text' : undefined,
                        }}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
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
          <span>
            {total} project(s) · {totalLines} line(s)
          </span>
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

      {editModalRow && (
        <EditProjectModal
          key={editModalRow.id}
          project={editModalRow}
          users={users ?? []}
          isAdmin={!!isAdmin}
          onClose={() => setEditModalRow(null)}
          onSave={onRowUpdate}
          onNotice={onNotice}
        />
      )}

      <UpdateHistoryModal project={historyRow} onClose={() => setHistoryRow(null)} />
      <IssuesModal project={issuesRow} users={users ?? []} onClose={() => setIssuesRow(null)} />
      {stageConfirmRow && (
        <StageConfirmModal
          projectName={stageConfirmRow.project_name}
          onConfirm={() => commitStageFinish(stageConfirmRow)}
          onCancel={() => setStageConfirmRow(null)}
        />
      )}
    </div>
  );
}