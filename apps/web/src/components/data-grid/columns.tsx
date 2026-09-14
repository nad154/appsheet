import { useRef, type ChangeEvent } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Project } from '@tracker/shared';
import { GOODS_OR_SERVICE, PROJECT_STAGES, computeAging } from '@tracker/shared';
import { useAuth } from '../../hooks/useAuth';
import { useUploadDocument } from '../../hooks/useDriveActions';
import { useToast } from '../Toast';

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
      return <span className="block truncate text-sm text-gray-800" title={String(v)}>{String(v)}</span>;
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

function selectDate(accessorKey: keyof Project, header: string, size = 170): ColumnDef<Project> {
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
      return <span className="block truncate text-sm text-gray-800" title={display}>{display}</span>;
    },
  };
}

function textareaCol(accessorKey: keyof Project, header: string, size = 200, isSortable = true): ColumnDef<Project> {
  return {
    accessorKey,
    header,
    size,
    enableSorting: isSortable,
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
    accessorKey: 'pic_name',
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

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

function UploadedDocCell({ row }: { row: Project }) {
  const { user } = useAuth();
  const uploadDoc = useUploadDocument();
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const docId = row.uploaded_doc_id;
  const docName = row.uploaded_doc_name;
  const hasFolder = Boolean(row.drive_folder_id);
  const isOwner = user?.id === row.staff_assigned_id;
  const canUpload = user?.role === 'SUPER_ADMIN' || isOwner;
  const enabled = canUpload && hasFolder;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadDoc.mutate(
      { projectId: row.id, file },
      {
        onSuccess: () => showToast('Document uploaded.', 'success'),
        onError: (err) => showToast(err instanceof Error ? err.message : 'Could not upload.', 'error'),
      },
    );
    e.target.value = '';
  };

  if (docId) {
    return (
      <span className="flex items-center gap-1">
        <a
          href={`https://drive.google.com/file/d/${docId}/view`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-600 underline"
          title={docName ?? 'Uploaded document'}
        >
          <span className="block max-w-[130px] truncate">{docName ?? 'Document'}</span>
        </a>
        {enabled && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Replace document"
          >
            <UploadIcon />
          </button>
        )}
        <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      </span>
    );
  }

  if (enabled) {
    return (
      <span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="Upload document"
        >
          <UploadIcon />
        </button>
        <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled
      className="cursor-not-allowed rounded p-0.5 text-gray-300"
      title={!hasFolder ? 'Link a Drive folder first' : 'No permission to upload'}
    >
      <UploadIcon />
    </button>
  );
}

const uploadedDocColumn: ColumnDef<Project> = {
  accessorKey: 'uploaded_doc_id',
  header: 'Document',
  size: 150,
  cell: ({ row }) => <UploadedDocCell row={row.original} />,
};

const agingColumn: ColumnDef<Project> = {
  id: 'aging',
  header: 'Aging',
  size: 90,
  accessorFn: (row) => computeAging(row),
  cell: ({ row }) => {
    const aging = computeAging(row.original);
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

// Derived server-side from Aging + current thresholds. Read-only in the grid:
// no `meta.editable` — ProjectTable.tsx only renders the edit affordance when
// meta.editable is true, so this column is non-editable by construction.
const priorityColumn: ColumnDef<Project> = {
  id: 'priority',
  header: 'Priority',
  size: 100,
  accessorKey: 'priority',
  cell: ({ row }) => {
    const p = row.original.priority;
    if (!p) return <span className="text-gray-300">—</span>;
    return (
      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[p]}`}>
        {PRIORITY_LABEL[p]}
      </span>
    );
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
      uploadedDocColumn,
      salesColumn(),
      picColumn(),
      selectCol('current_stage', 'Stage', 120, PROJECT_STAGES),
      // selectCol('service_or_goods', 'Type', 120, GOODS_OR_SERVICE),
    ],
  },
  {
    id: 'customer',
    header: 'Customer Section',
    columns: [
      text('customer_name', 'Customer', 160),
      text('market_segment', 'Market Segment', 140),
      selectCol('service_or_goods', 'Service/Goods', 120, GOODS_OR_SERVICE), 
      selectDate('date_customer_received_doc1', 'Tanggal Terima SP Customer', 170),
      selectDate('date_customer_received_doc2', 'Tanggal Terima PO/PKS Customer', 170),
      text('doc2_number_id', 'No PO/PKS Customer', 170),
      numberCol('customer_price', 'Amount PO/PKS Customer', 110),
      selectDate('customer_start_contract', 'Start Contract - Cust', 170),
      selectDate('customer_end_contract', 'End Contract - Cust', 170),
    ],
  },
  {
    id: 'vendor',
    header: 'Vendor Section',
    columns: [
      text('vendor_name', 'Vendor', 160),
      numberCol('vendor_revenue', 'Nilai RAB', 120),
      selectCol('vendor_type', 'Type Vendor Service/Goods', 120, GOODS_OR_SERVICE),
      selectDate('project_sent_date', 'Tgl Kirim FPT', 170),
      selectDate('project_finish_date', 'Tgl Finish FPT', 170),
      text('vendor_project_id', 'No FPT', 170),
      selectDate('negotiation_date', 'Tanggal Nego Vendor', 170),
      selectDate('approval_date', 'Tanggal Terima SP Vendor', 170),
      selectDate('document_sent_date', 'Tanggal kirim PO/PKS vendor', 170),
      text('document_id', 'No PO/PKS', 170),
      numberCol('vendor_price', 'Nilai PO/PKS', 120),
      selectDate('vendor_start_contract', 'Start Contract2', 170),
      selectDate('vendor_end_contract', 'End Contract2', 170),
      agingColumn,
      priorityColumn,
      textareaCol('issues', 'Issues', 200, false),
    ],
  },
];

export type ActiveCell = { rowId: string; field: string } | null;
