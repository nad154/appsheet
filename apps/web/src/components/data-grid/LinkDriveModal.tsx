import { useState } from 'react';
import type { Project } from '@tracker/shared';
import { useLinkFolder, useCreateFolder } from '../../hooks/useDriveActions';
import type { ToastVariant } from '../Toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { controlClass } from '../ui/Input';

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

  return (
    <Modal
      ariaLabel={`Link Drive folder for ${project.project_name}`}
      eyebrow="Drive folder"
      title={project.project_name}
      onClose={onClose}
      maxWidthClass="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !canSubmit}>
            {busy ? 'Saving…' : mode === 'link' ? 'Link folder' : 'Create folder'}
          </Button>
        </>
      }
    >
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
              className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-border text-ink-muted hover:bg-canvas'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Drive folder URL or ID
              <input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/… or folder ID"
                aria-label="Drive folder URL or ID"
                className={controlClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Folder name <span className="font-normal text-ink-muted/70">(optional — shown in the grid)</span>
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Name shown in the Folder column"
                aria-label="Folder name"
                className={controlClass}
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Creates a new folder inside the app's Drive root and links it to this project.
            </p>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Folder name
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Folder name"
                aria-label="Folder name"
                className={controlClass}
              />
            </label>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
