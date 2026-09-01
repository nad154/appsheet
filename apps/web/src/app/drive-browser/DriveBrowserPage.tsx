import { useState } from 'react';
import { useDriveBrowse } from '../../hooks/useDrive';
import type { DriveFileEntry } from '@tracker/shared';

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

  const isRoot = depth === 0;

  return (
    <li>
      <div className="flex items-center gap-2 py-1" style={indent}>
        <button
          type="button"
          onClick={toggle}
          className="inline-flex min-w-6 items-center justify-center text-sm text-gray-500 hover:bg-gray-100"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        >
          {isLoading ? '…' : expanded ? '▾' : '▸'}
        </button>
        <span className="text-sm">{isRoot ? '🗀' : '📁'}</span>
        <span className="truncate text-sm font-medium text-gray-800">{label}</span>
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

  if (isLoading && !children) return <li style={indent} className="py-1 text-xs text-gray-400">Loading…</li>;
  if (isError && !children) {
    return (
      <li style={indent} className="py-1 text-xs text-red-600">
        {error instanceof Error ? error.message : 'Failed to load folder.'}
      </li>
    );
  }
  if (!children || children.length === 0) {
    return <li style={indent} className="py-1 text-xs text-gray-400">Empty folder</li>;
  }

  return (
    <>
      {children.map((entry) =>
        isFolder(entry) ? (
          <FolderNode key={entry.id} folderId={entry.id} label={entry.name} depth={depth} />
        ) : (
          <li key={entry.id} style={indent} className="flex items-center gap-2 py-1">
            <span className="text-sm">📄</span>
            <span className="truncate text-sm text-gray-700">{entry.name}</span>
          </li>
        ),
      )}
    </>
  );
}

export function DriveBrowserPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Drive Browser</h1>
      <div className="rounded border border-gray-200 p-3">
        <ul>
          <FolderNode folderId={null} label="root_folder" depth={0} />
        </ul>
      </div>
    </div>
  );
}
