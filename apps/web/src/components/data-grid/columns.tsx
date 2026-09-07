import type { ColumnDef } from '@tanstack/react-table';
import type { Project } from '@tracker/shared';
import { GOODS_OR_SERVICE, PROJECT_STAGES, computeAging } from '@tracker/shared';
import { StatusFlagCell } from './StatusFlagCell';

export type EditType = 'text' | 'number' | 'select' | 'date' | 'textarea' | 'user';

export interface ColumnMeta {
  editable?: boolean;
  editType?: EditType;
  options?: readonly string[];
  pendingFlag?: boolean;
  adminOnly?: boolean;
}

function text(accessorKey: keyof Project, header: string, size = 150, editable = true): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    meta: editable ? ({ editable: true, editType: 'text' } as ColumnMeta) : undefined,
    cell: ({ getValue }) => {
      const v = getValue();
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{String(v)}</span>;
    },
  };
}

function numberCol(accessorKey: keyof Project, header: string, size = 120): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    meta: { editable: true, editType: 'number' } as ColumnMeta,
    cell: ({ getValue }) => {
      const v = getValue();
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">Rp —</span>;
      return <span className="block truncate text-sm text-gray-800">Rp {Number(v).toLocaleString('en-US')}</span>;
    },
  };
}

function selectCol(
  accessorKey: keyof Project,
  header: string,
  size: number,
  options: readonly string[],
): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    meta: { editable: true, editType: 'select', options } as ColumnMeta,
    cell: ({ getValue }) => {
      const v = getValue() as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{v}</span>;
    },
  };
}

function selectDate(accessorKey: keyof Project, header: string, size = 130): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    meta: { editable: true, editType: 'date' } as ColumnMeta,
    cell: ({ getValue }) => {
      const v = getValue() as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      const d = new Date(v);
      const display = Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      return <span className="block truncate text-sm text-gray-800">{display}</span>;
    },
  };
}

function textareaCol(accessorKey: keyof Project, header: string, size = 200): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    meta: { editable: true, editType: 'textarea' } as ColumnMeta,
    cell: ({ getValue }) => {
      const v = getValue() as string | null | undefined;
      if (!v) return <span className="text-gray-300">—</span>;
      return (
        <span className="block truncate text-sm text-gray-800" title={v}>
          {v}
        </span>
      );
    },
  };
}

// PIC is an assignable user (stores pic_id, a user UUID). The cell displays the
// resolved pic_name from the server JOIN; inline editing opens a user dropdown.
function picColumn(size = 140): ColumnDef<Project> {
  return {
    accessorKey: 'pic_id',
    header: 'PIC',
    size,
    meta: { editable: true, editType: 'user' } as ColumnMeta,
    cell: ({ row }) => {
      const name = row.original.pic_name;
      if (!name) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{name}</span>;
    },
  };
}

// Sales (assigned staff) is an assignable user, editable only by SUPER_ADMIN.
// Stores staff_assigned_id; displays the resolved staff_assigned_name from the
// server JOIN. STAFF can never reassign — the server enforces this.
function salesColumn(size = 140): ColumnDef<Project> {
  return {
    accessorKey: 'staff_assigned_id',
    header: 'Sales',
    size,
    meta: { editable: true, editType: 'user', adminOnly: true } as ColumnMeta,
    cell: ({ row }) => {
      const name = row.original.staff_assigned_name;
      if (!name) return <span className="text-gray-300">—</span>;
      return <span className="block truncate text-sm text-gray-800">{name}</span>;
    },
  };
}

const driveLinkColumn: ColumnDef<Project> = {
  accessorKey: 'drive_folder_id',
  header: 'Folder',
  size: 100,
  cell: ({ row }) => {
    // const id = getValue() as string | null | undefined;
    const id = row.original.drive_folder_id;
    const name = row.original.folder_name;

    if (!name && !id) return <span className="text-gray-300">—</span>;
    if(!id) return (
      <p className="text-sm underline">
        {name}
      </p>
    )
    if(!name) return (
      <a
        href={`https://drive.google.com/drive/folders/${id}`}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-blue-600 underline"
        aria-label="Open Drive folder"
      >
        Folder
      </a>
    )
    return (
      <a
        href={`https://drive.google.com/drive/folders/${id}`}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-blue-600 underline"
        aria-label="Open Drive folder"
      >
        {name}
      </a>
    );
  },
};

const statusColumn: ColumnDef<Project> = {
  id: 'status_flag',
  header: 'Status',
  size: 110,
  enableSorting: false,
  cell: ({ row }) => <StatusFlagCell project={row.original} />,
};

const pendingColumn: ColumnDef<Project> = {
  id: 'pending_flag',
  header: 'Pending',
  size: 90,
  enableSorting: false,
  meta: { pendingFlag: true } as ColumnMeta,
  cell: ({ row, table }) => {
    const pendingIds = (table.options.meta as { pendingProjectIds?: Set<string> } | undefined)
      ?.pendingProjectIds;
    const hasPending = pendingIds?.has(row.original.id);
    if (!hasPending) return <span />;
    return (
      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        Pending
      </span>
    );
  },
};

const agingColumn: ColumnDef<Project> = {
  id: 'aging',
  header: 'Aging',
  size: 90,
  enableSorting: false,
  cell: ({ row }) => {
    const aging = computeAging(row.original);
    if (aging === null) return <span className="text-gray-300">—</span>;
    return <span className="block text-sm text-gray-800">{aging}</span>;
  },
};

export const projectColumns: ColumnDef<Project>[] = [
  {
    id: 'project_info',
    header: 'Project Info',
    columns: [
      text('project_name', 'Project', 220),
      // text('folder_name', 'Folder', 160),
      driveLinkColumn,
      salesColumn(),
      picColumn(),
      selectCol('current_stage', 'Stage', 120, PROJECT_STAGES),
      // selectCol('service_or_goods', 'Type', 120, GOODS_OR_SERVICE),
      // statusColumn,
      // pendingColumn,
    ],
  },
  {
    id: 'customer',
    header: 'Customer Section',
    columns: [
      text('customer_name', 'Customer', 160),
      text('market_segment', 'Market Segment', 140),
      selectCol('service_or_goods', 'Service/Goods', 120, GOODS_OR_SERVICE), 
      selectDate('date_customer_received_doc1', 'Tanggal Terima SP Customer', 140),
      selectDate('date_customer_received_doc2', 'Tanggal Terima PO/PKS Customer', 140),
      text('doc2_number_id', 'No PO/PKS Customer', 120),
      numberCol('customer_price', 'Amount PO/PKS Customer', 110),
      selectDate('customer_start_contract', 'Start Contract - Cust', 130),
      selectDate('customer_end_contract', 'End Contract - Cust', 130),
    ],
  },
  {
    id: 'vendor',
    header: 'Vendor Section',
    columns: [
      text('vendor_name', 'Vendor', 160),
      numberCol('vendor_revenue', 'Nilai RAB', 120),
      selectCol('vendor_type', 'Type Vendor Service/Goods', 120, GOODS_OR_SERVICE),
      selectDate('project_sent_date', 'Tgl Kirim FPT', 130),
      selectDate('project_finish_date', 'Tgl Finish FPT', 130),
      text('vendor_project_id', 'No FPT', 130),
      selectDate('negotiation_date', 'Tanggal Nego Vendor', 130),
      selectDate('approval_date', 'Tanggal Terima SP Vendor', 130),
      selectDate('document_sent_date', 'Tanggal kirim PO/PKS vendor', 130),
      text('document_id', 'No PO/PKS', 130),
      numberCol('vendor_price', 'Nilai PO/PKS', 120),
      selectDate('vendor_start_contract', 'Start Contract2', 130),
      selectDate('vendor_end_contract', 'End Contract2', 130),
      agingColumn,
      textareaCol('issues', 'Issues', 200),
    ],
  },
];

export type ActiveCell = { rowId: string; field: string } | null;
