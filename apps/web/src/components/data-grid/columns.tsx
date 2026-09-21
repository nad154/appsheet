import type { ColumnDef } from '@tanstack/react-table';
import type { Project, ProjectStage, ProjectVendorLine } from '@tracker/shared';
import { GOODS_OR_SERVICE, computeAging } from '@tracker/shared';
import { formatGridDate, formatGridNumber } from '../../lib/format';

export type EditType = 'text' | 'number' | 'select' | 'date' | 'textarea' | 'user';

export interface ColumnMeta {
  editable?: boolean;
  editType?: EditType;
  options?: readonly string[];
  pendingFlag?: boolean;
  adminOnly?: boolean;
}

// One row the grid renders. Project-level cells render only on the first
// (group-header) row of that project; each vendor line renders its own
// continuation row; a project with zero vendor lines renders exactly one
// blank-vendor row (planning_customers_vendors §0 mock / §3.1).
export type DisplayRow = {
  project: Project;
  vendor: ProjectVendorLine | null;
  isFirstOfGroup: boolean;
  rowKey: string;
  // Page-relative project ordinal for the number column — counts projects (not
  // vendor lines), so every line of a multi-vendor project shares one number.
  index: number;
};

// Project-level value, blanked out on continuation rows. The muted "—" styling
// in the cell renderers makes the blank visually match the mock.
function projectCell(row: DisplayRow, key: keyof Project): unknown {
  return row.isFirstOfGroup ? row.project[key] : '';
}

// Vendor-line value, blank "—" when the row has no vendor line (zero-vendor
// project renders its single blank row).
function vendorCell(row: DisplayRow, key: keyof ProjectVendorLine): unknown {
  return row.vendor ? row.vendor[key] : '';
}

function text(
  accessorKey: keyof Project,
  header: string,
  size = 150,
  editable = true,
  sortable = true,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: accessorKey as string,
    header,
    size,
    enableSorting: sortable,
    meta: editable ? ({ editable: true, editType: 'text' } as ColumnMeta) : undefined,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const v = projectCell(row.original, accessorKey);
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800" title={String(v)}>{String(v)}</span>;
    },
  };
}

// Project column. The first sticky cell in the row hosts the unread-update
// yellow dot (front of the row) — a visual marker only, shown to admins when a
// STAFF member has recorded a progress note that hasn't been reviewed yet.
// Keeps meta.editable so inline edit + the row pencil still work, matching the
// previous text('project_name', ...) column.
function ProjectNameCell({
  row,
  isAdmin,
}: {
  row: DisplayRow;
  isAdmin: boolean;
}) {
  const name = row.project.project_name;
  const unread = !!row.project.has_unread_update;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {isAdmin && unread && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="Unread update" data-testid="unread-update-dot" />
      )}
      <span className="block min-w-0 flex-1 break-words text-sm leading-snug text-gray-800">
        {name}
      </span>
    </span>
  );
}

function projectNameColumn(isAdmin: boolean): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'project_name',
    header: 'Project',
    // Width includes the always-reserved pencil slot (see ProjectTable), so the
    // hover-revealed edit button never crowds the name text.
    size: 300,
    enableSorting: false,
    meta: { editable: true, editType: 'text' } as ColumnMeta,
    cell: ({ row }) => (row.original.isFirstOfGroup ? <ProjectNameCell row={row.original} isAdmin={isAdmin} /> : null),
  };
}

// Page-relative project ordinal (a display-only row counter, not a stored
// field). Renders once per project on its group-header row; continuation vendor
// rows are blank. Not sortable and never editable.
const projectNumberColumn: ColumnDef<DisplayRow> = {
  id: 'number',
  header: '#',
  size: 48,
  enableSorting: false,
  cell: ({ row }) => {
    if (!row.original.isFirstOfGroup) return null;
    return <span className="block text-sm text-gray-500">{row.original.index}</span>;
  },
};

function numberCol(accessorKey: keyof Project, header: string, size = 120): ColumnDef<DisplayRow> {
  return {
    accessorKey: accessorKey as string,
    header,
    size,
    meta: { editable: true, editType: 'number' } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const v = projectCell(row.original, accessorKey);
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">Rp —</span>;
      return <span className="block truncate text-sm text-gray-800">Rp {formatGridNumber(v as string | number | null | undefined)}</span>;
    },
  };
}

function selectCol(
  accessorKey: keyof Project,
  header: string,
  size: number,
  options: readonly string[],
  sortable = true,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: accessorKey as string,
    header,
    size,
    enableSorting: sortable,
    meta: { editable: true, editType: 'select', options } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const v = projectCell(row.original, accessorKey) as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{v}</span>;
    },
  };
}

function selectDate(accessorKey: keyof Project, header: string, size = 170): ColumnDef<DisplayRow> {
  return {
    accessorKey: accessorKey as string,
    header,
    size,
    meta: { editable: true, editType: 'date' } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const v = projectCell(row.original, accessorKey) as string | null | undefined;
      const display = formatGridDate(v);
      if (!display) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800" title={display}>{display}</span>;
    },
  };
}

// Customer is a read-only display of the joined lookup name (like the previous
// read-only text() column), but a project whose customer row was deleted shows
// the muted "(deleted customer)" orphan label instead of a blank — mirroring
// the edit modal, so an orphan stays visibly distinct from "never set"
// (planning_customers_vendors §3.4).
function customerColumn(size = 160): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'customer_name',
    header: 'Customer',
    size,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const { customer_id, customer_name } = row.original.project;
      if (!customer_name) {
        if (customer_id) {
          return <span className="block truncate text-sm italic text-gray-400">(deleted customer)</span>;
        }
        return <span className="text-gray-300">—</span>;
      }
      return <span className="block break-words text-sm leading-snug text-gray-800">{customer_name}</span>;
    },
  };
}

// PIC is an assignable user (stores pic_id, a user UUID). The cell displays the
// resolved pic_name from the server JOIN; inline editing opens a user dropdown.
// accessorKey is pic_id (the persisted FK the editor commits), while the sort
// key sent to the server maps through SORTABLE_COLUMNS['pic_id'] → the joined
// user name.
function picColumn(size = 140): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'pic_id',
    header: 'PIC',
    size,
    meta: { editable: true, editType: 'user' } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const name = projectCell(row.original, 'pic_name') as string | null | undefined;
      if (!name) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{name}</span>;
    },
  };
}

// Sales (assigned staff) is an assignable user, editable only by SUPER_ADMIN.
// Stores staff_assigned_id; displays the resolved staff_assigned_name from the
// server JOIN. STAFF can never reassign — the server enforces this.
function salesColumn(size = 140): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'staff_assigned_id',
    header: 'Sales',
    size,
    meta: { editable: true, editType: 'user', adminOnly: true } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const name = projectCell(row.original, 'staff_assigned_name') as string | null | undefined;
      if (!name) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{name}</span>;
    },
  };
}

// Folder column: shows the linked folder as a Drive deep link, a plain name
// when only folder_name is set, or "—" when unlinked. For SUPER_ADMIN an
// unlinked project's cell is clickable — it opens the quick LinkDriveModal so a
// folder can be linked/created without opening the full edit modal.
function driveLinkColumn(
  isAdmin: boolean,
  onLinkDrive: (project: Project) => void,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'drive_folder_id',
    header: 'Folder',
    size: 160,
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const project = row.original.project;
      const id = project.drive_folder_id;
      const name = project.folder_name;

      if (id) {
        return (
          <a
            href={`https://drive.google.com/drive/folders/${id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-blue-600 underline"
            aria-label="Open Drive folder"
          >
            {name || 'Folder'}
          </a>
        );
      }

      const empty = !name ? (
        <span className="text-gray-300">—</span>
      ) : (
        <span className="block truncate text-sm underline">{name}</span>
      );

      if (!isAdmin) return empty;

      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLinkDrive(project);
          }}
          className="flex w-full items-center gap-1.5 rounded text-left hover:outline hover:outline-1 hover:outline-blue-300"
          title="Link a Google Drive folder"
          aria-label={`Link Drive folder for ${project.project_name}`}
        >
          {empty}
        </button>
      );
    },
  };
}

// Per-vendor-line derived cells. Not sortable and not inline-editable — vendor
// fields are modal-only (user decision for planning_customers_vendors Phase 5).
function vendorTextCol(header: string, size = 160): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'vendor_name',
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const line = row.original.vendor;
      if (!line) return <span className="text-gray-300">—</span>;
      const v = line.vendor_name;
      if (!v) {
        if (line.vendor_id) {
          return <span className="block truncate text-sm italic text-gray-400">(deleted vendor)</span>;
        }
        return <span className="text-gray-300">—</span>;
      }
      return <span className="block break-words text-sm leading-snug text-gray-800">{v}</span>;
    },
  };
}

function vendorNumberCol(header: string, size = 120): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'vendor_price',
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const v = vendorCell(row.original, 'vendor_price');
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">Rp —</span>;
      return <span className="block truncate text-sm text-gray-800">Rp {formatGridNumber(v as string | number | null | undefined)}</span>;
    },
  };
}

function vendorSelectCol(
  key: keyof ProjectVendorLine,
  header: string,
  size: number,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: key as string,
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const v = vendorCell(row.original, key) as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{v}</span>;
    },
  };
}

function vendorDateCol(key: keyof ProjectVendorLine, header: string, size = 170): ColumnDef<DisplayRow> {
  return {
    accessorKey: key as string,
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const v = vendorCell(row.original, key) as string | null | undefined;
      const display = formatGridDate(v);
      if (!display) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800" title={display}>{display}</span>;
    },
  };
}

function vendorTextInputCol(key: keyof ProjectVendorLine, header: string, size = 170): ColumnDef<DisplayRow> {
  return {
    accessorKey: key as string,
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const v = vendorCell(row.original, key) as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800" title={v}>{v}</span>;
    },
  };
}

const agingColumn: ColumnDef<DisplayRow> = {
  id: 'aging',
  header: 'Aging',
  size: 90,
  enableSorting: false,
  accessorFn: (row) => computeAging(row.vendor ?? {}),
  cell: ({ row }) => {
    const aging = computeAging(row.original.vendor ?? {});
    if (aging === null) return <span className="text-gray-300">—</span>;
    return <span className="block text-sm text-gray-800">{aging}</span>;
  },
};

const PRIORITY_STYLES: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  high: 'bg-red-100 text-red-800 border-red-300',
};
const PRIORITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const STAGE_LABEL: Record<ProjectStage, string> = {
  on_progress: 'On Progress',
  finish: 'Finish',
};
export const STAGE_STYLES: Record<ProjectStage, string> = {
  on_progress: 'bg-blue-100 text-blue-800 border-blue-300',
  finish: 'bg-green-100 text-green-800 border-green-300',
};

// Stage badge, styled like the priority badge. Display always shows one of the
// two stages (never "—"; legacy/blank rows fall back to on_progress). Only
// SUPER_ADMIN can modify the stage: on an on_progress project the badge is
// clickable (opens the finish-confirm modal); a finished project is locked and
// can never be reopened.
function stageColumn(onRequestFinish: (project: Project) => void, isAdmin: boolean): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'current_stage',
    header: 'Stage',
    size: 120,
    enableSorting: false,
    meta: { editable: false, editType: 'select', options: ['on_progress', 'finish'] as const } as ColumnMeta,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      const stage: ProjectStage = row.original.project.current_stage ?? 'on_progress';
      const badge = (
        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[stage]}`}>
          {STAGE_LABEL[stage]}
        </span>
      );
      if (!isAdmin || stage === 'finish') return badge;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestFinish(row.original.project);
          }}
          className="rounded px-0 text-left hover:outline hover:outline-1 hover:outline-blue-300"
          title="Mark project as Finish"
          aria-label={`Mark ${row.original.project.project_name} as Finish`}
        >
          {badge}
        </button>
      );
    },
  };
}

// Per-vendor-line, derived server-side from Aging + current thresholds.
// Read-only and not sortable — like all vendor fields.
const priorityColumn: ColumnDef<DisplayRow> = {
  id: 'priority',
  header: 'Priority',
  size: 100,
  enableSorting: false,
  accessorKey: 'priority',
  cell: ({ row }) => {
    const p = row.original.vendor?.priority;
    if (!p) return <span className="text-gray-300">—</span>;
    return (
      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[p]}`}>
        {PRIORITY_LABEL[p]}
      </span>
    );
  },
};

// Far-right column: latest STAFF update-progress note. The unread indicator
// lives at the front of the row, next to the project name (ProjectNameCell
// below). Read-only in the grid (no meta.editable) — clickable only by
// SUPER_ADMIN, who opens the history modal; STAFF just sees the note text.
function UpdateProgressCell({
  row,
  isAdmin,
  onOpenHistory,
}: {
  row: DisplayRow;
  isAdmin: boolean;
  onOpenHistory: (project: Project) => void;
}) {
  const text = row.project.update_progress;
  const content = text ? (
    <span className="block truncate text-sm text-gray-800" title={text}>{text}</span>
  ) : (
    <span className="text-gray-300">—</span>
  );

  if (!isAdmin) return content;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenHistory(row.project);
      }}
      className="flex w-full items-center gap-1.5 text-left hover:underline"
      title="View update history"
    >
      {content}
    </button>
  );
}

function updateProgressColumn(
  onOpenHistory: (project: Project) => void,
  isAdmin: boolean,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'update_progress',
    header: 'Update Progress',
    size: 220,
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      return <UpdateProgressCell row={row.original} isAdmin={isAdmin} onOpenHistory={onOpenHistory} />;
    },
  };
}

function formatIssueDate(v: string): string {
  return formatGridDate(v, 'short');
}

// Issues column: the latest issue's text (denormalized projects.issues) plus
// its date and assignee (derived from project_issues). Read-only in the grid —
// clickable only by SUPER_ADMIN, who opens the issues modal (add + history);
// STAFF just sees the latest issue.
function IssuesCell({
  row,
  isAdmin,
  onOpenIssues,
}: {
  row: DisplayRow;
  isAdmin: boolean;
  onOpenIssues: (project: Project) => void;
}) {
  const text = row.project.issues;
  const issueDate = row.project.latest_issue_date;
  const assignee = row.project.latest_issue_assignee;

  const content = text ? (
    <span className="flex min-w-0 flex-col leading-snug">
      <span className="block truncate text-sm text-gray-800" title={text}>{text}</span>
      <span className="block truncate text-[11px] text-gray-400">
        {issueDate ? formatIssueDate(issueDate) : '—'}
        {assignee ? ` · ${assignee}` : ''}
      </span>
    </span>
  ) : (
    <span className="text-gray-300">—</span>
  );

  if (!isAdmin) return content;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenIssues(row.project);
      }}
      className="flex w-full items-center gap-1.5 text-left hover:underline"
      title="View issues"
    >
      {content}
    </button>
  );
}

function issuesColumn(
  onOpenIssues: (project: Project) => void,
  isAdmin: boolean,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: 'issues',
    header: 'Issues',
    size: 220,
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.original.isFirstOfGroup) return null;
      return <IssuesCell row={row.original} isAdmin={isAdmin} onOpenIssues={onOpenIssues} />;
    },
  };
}

export function buildProjectColumns({ isAdmin, onOpenHistory, onOpenIssues, onRequestFinish, onLinkDrive }: {
  isAdmin: boolean;
  onOpenHistory: (project: Project) => void;
  onOpenIssues: (project: Project) => void;
  onRequestFinish: (project: Project) => void;
  onLinkDrive: (project: Project) => void;
}): ColumnDef<DisplayRow>[] {
  return [
    {
      id: 'project_info',
      header: 'Project Info',
      columns: [
        projectNumberColumn,
        driveLinkColumn(isAdmin, onLinkDrive),
        projectNameColumn(isAdmin),
        salesColumn(),
        picColumn(),
        stageColumn(onRequestFinish, isAdmin),
        // selectDate('created_at', 'Created', 150),
        // {
        //   id: 'status_flag',
        //   header: 'Status',
        //   size: 110,
        //   enableSorting: false,
        //   cell: ({ row }) =>
        //     row.original.isFirstOfGroup ? <StatusFlagCell project={row.original.project} /> : <span className="text-gray-300">—</span>,
        // },
        issuesColumn(onOpenIssues, isAdmin),
      ],
    },
    {
      id: 'customer',
      header: 'Customer Section',
      columns: [
        customerColumn(),
        text('market_segment', 'Market Segment', 140, true, false),
        selectCol('service_or_goods', 'Service/Goods', 120, GOODS_OR_SERVICE, false),
        selectDate('date_customer_received_doc1', 'Tanggal Terima SP Customer', 170),
        selectDate('date_customer_received_doc2', 'Tanggal Terima PO/PKS Customer', 170),
        text('doc2_number_id', 'No PO/PKS Customer', 150, true, false),
        numberCol('customer_price', 'Nilai PO/PKS Customer', 130),
        selectDate('customer_start_contract', 'Start Contract - Cust', 170),
        selectDate('customer_end_contract', 'End Contract - Cust', 170),
      ],
    },
    {
      id: 'vendor',
      header: 'Vendor Section',
      // Vendor fields moved onto per-project vendor lines: read-only,
      // non-sortable, one row per line (planning_customers_vendors Phase 5).
      columns: [
        vendorTextCol('Vendor', 200),
        vendorNumberCol('Nilai RAB', 120),
        vendorSelectCol('vendor_type', 'Type Vendor Service/Goods', 120),
        vendorDateCol('project_sent_date', 'Tanggal Kirim FPT', 170),
        vendorDateCol('project_finish_date', 'Tgl Finish FPT', 170),
        vendorTextInputCol('vendor_project_id', 'No FPT', 170),
        vendorDateCol('negotiation_date', 'Tanggal Nego Vendor', 170),
        vendorDateCol('approval_date', 'Tanggal Terima SP Vendor', 170),
        vendorDateCol('document_sent_date', 'Tanggal kirim PO/PKS vendor', 170),
        vendorTextInputCol('document_id', 'No PO/PKS Vendor', 170),
        vendorNumberCol('Nilai PO/PKS Vendor', 150),
        vendorDateCol('vendor_start_contract', 'Start Contract - Vendor', 170),
        vendorDateCol('vendor_end_contract', 'End Contract2 - Vendor', 170),
        agingColumn,
        priorityColumn,
      ],
    },
    {
      id: 'update_progress',
      header: 'Update Progress',
      columns: [updateProgressColumn(onOpenHistory, isAdmin)],
    },
  ];
}

export type ActiveCell = { rowId: string; field: string } | null;