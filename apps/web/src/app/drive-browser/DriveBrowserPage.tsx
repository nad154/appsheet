import { useState } from 'react';
import { useDriveBrowse } from '../../hooks/useDrive';
import type { DriveFileEntry } from '@tracker/shared';
import { FolderIcon, FileIcon, ChevronDownIcon, ChevronRightIcon } from '../../components/ui/icons';
import { PageHeader } from '../../components/ui/PageHeader';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function isFolder(entry: DriveFileEntry): boolean {
  return entry.mimeType === FOLDER_MIME;
}

interface FolderNodeProps {
  folderId: string | null; // null = root level
  label: string;
  depth: number;
}

function FolderNode({ folderId, label, depth }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: children, isLoading, isError, error } = useDriveBrowse(expanded ? folderId : null);

  const toggle = () => setExpanded((e) => !e);
  const indent = { paddingLeft: `${depth * 16 + 4}px` };

  return (
    <li>
      <div className="flex items-center gap-2 py-1" style={indent}>
        <button
          type="button"
          onClick={toggle}
          className="inline-flex min-w-6 items-center justify-center rounded text-ink-muted hover:bg-canvas"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        >
          {isLoading ? (
            '…'
          ) : expanded ? (
            <ChevronDownIcon size={14} aria-hidden="true" />
          ) : (
            <ChevronRightIcon size={14} aria-hidden="true" />
          )}
        </button>
        <FolderIcon size={15} aria-hidden="true" className="shrink-0 text-accent" />
        <span className="truncate text-sm font-medium text-ink">{label}</span>
      </div>
      {expanded && (
        <ul>
          <ChildrenList {...{ children, isLoading, isError, error, depth: depth + 1 }} />
        </ul>
      )}
    </li>
  );
}

function ChildrenList({
  children,
  isLoading,
  isError,
  error,
  depth,
}: {
  children: DriveFileEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  depth: number;
}) {
  const indent = { paddingLeft: `${depth * 16 + 4}px` };

  if (isLoading && !children) return <li style={indent} className="py-1 text-xs text-ink-muted">Loading…</li>;
  if (isError && !children) {
    return (
      <li style={indent} className="py-1 text-xs text-danger">
        {error instanceof Error ? error.message : 'Failed to load folder.'}
      </li>
    );
  }
  if (!children || children.length === 0) {
    return <li style={indent} className="py-1 text-xs text-ink-muted">Empty folder</li>;
  }

  return (
    <>
      {children.map((entry) =>
        isFolder(entry) ? (
          <FolderNode key={entry.id} folderId={entry.id} label={entry.name} depth={depth} />
        ) : (
          <li key={entry.id} style={indent} className="flex items-center gap-2 py-1">
            <FileIcon size={15} aria-hidden="true" className="shrink-0 text-ink-muted" />
            <span className="truncate text-sm text-ink">{entry.name}</span>
          </li>
        ),
      )}
    </>
  );
}

export function DriveBrowserPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Drive Browser" />
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        <ul>
          <FolderNode folderId={null} label="root_folder" depth={0} />
        </ul>
      </div>
    </div>
  );
}
