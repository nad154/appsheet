import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '@tracker/shared';
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import type { ToastVariant } from '../Toast';

// Quick Drive-folder modal opened from the grid's Folder column when a project
// has no linked folder (SUPER_ADMIN only). Two actions:
//   - Link to existing drive: paste a Drive folder URL/ID (optionally a display
//     name, which is stored as the project's folder_name).
//   - Create drive folder: new Drive subfolder named after the input, linked
//     and stored under folder_name too.
interface LinkDriveModalProps {
  project: Project;
  onClose: () => void;
  onNotice?: (message: string, variant?: ToastVariant) => void;
}

export function LinkDriveModal({ project, onClose, onNotice }: LinkDriveModalProps) {
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [linkInput, setLinkInput] = useState('');
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkFolder = useLinkFolder();
  const createFolder = useCreateFolder();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const name = folderName.trim();
    try {
      if (mode === 'link') {
        await linkFolder.mutateAsync({
          projectId: project.id,
          folderInput: linkInput.trim(),
          ...(name ? { folderName: name } : {}),
        });
        onNotice?.('Folder linked.', 'success');
      } else {
        await createFolder.mutateAsync({ projectId: project.id, folderName: name });
        onNotice?.('Drive folder created and linked.', 'success');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link the folder.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === 'link' ? linkInput.trim().length > 0 : folderName.trim().length > 0;

  const inputCls =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Link Drive folder for ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Drive folder</p>
            <h2 className="text-base font-semibold text-gray-800">{project.project_name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 flex gap-2">
            {(
              [
                { id: 'link' as const, label: 'Link to existing drive' },
                { id: 'create' as const, label: 'Create drive folder' },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMode(tab.id);
                  setError(null);
                }}
                aria-pressed={mode === tab.id}
                className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium ${
                  mode === tab.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'link' ? (
            <div className="space-y-3">
              <label className="flex flex-col text-xs text-gray-600">
                Drive folder URL or ID
                <input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/… or folder ID"
                  aria-label="Drive folder URL or ID"
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col text-xs text-gray-600">
                Folder name <span className="font-normal text-gray-400">(optional — shown in the grid)</span>
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Name shown in the Folder column"
                  aria-label="Folder name"
                  className={inputCls}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Creates a new folder inside the app's Drive root and links it to this project.
              </p>
              <label className="flex flex-col text-xs text-gray-600">
                Folder name
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Folder name"
                  aria-label="Folder name"
                  className={inputCls}
                />
              </label>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !canSubmit}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy
                ? 'Saving…'
                : mode === 'link'
                  ? 'Link folder'
                  : 'Create folder'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}