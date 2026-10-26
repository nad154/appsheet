import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface DeleteProjectConfirmModalProps {
  projectName: string;
  vendorLineCount: number;
  // Shown inline when the delete request fails — the message lands here
  // instead of behind this overlay.
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

// Blocking confirmation for the SUPER_ADMIN-only project delete. The delete is
// a hard delete on the server (project + vendor lines + update history +
// logged issues), so the copy spells out what goes and what stays.
export function DeleteProjectConfirmModal({
  projectName,
  vendorLineCount,
  error,
  onConfirm,
  onCancel,
  busy,
}: DeleteProjectConfirmModalProps) {
  const linesLabel = vendorLineCount === 1 ? '1 vendor line' : `${vendorLineCount} vendor lines`;
  return (
    <Modal
      ariaLabel="Confirm delete project"
      title="Delete project?"
      overlayClassName="z-[60]"
      closeOnOverlayClick={!busy}
      onClose={() => {
        if (!busy) onCancel();
      }}
      maxWidthClass="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-delete-project"
          >
            {busy ? 'Deleting…' : 'Delete project'}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <p className="text-sm text-ink-muted">
          “<span className="font-medium text-ink">{projectName}</span>” will be permanently deleted, together with its{' '}
          <span className="font-medium text-ink">{linesLabel}</span>, its update history and its logged issues.
        </p>
        {/* Removed: linked Google Drive folder note (see UNUSED_DRIVE.md) */}
        <p className="mt-2 text-sm text-ink-muted">This action cannot be undone.</p>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
