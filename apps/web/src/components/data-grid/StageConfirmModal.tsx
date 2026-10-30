import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface StageConfirmModalProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function StageConfirmModal({ projectName, onConfirm, onCancel, busy }: StageConfirmModalProps) {
  return (
    <Modal
      ariaLabel="Confirm finish stage"
      title="Mark project as Finish?"
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
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Marking…' : 'Mark as Finish'}
          </Button>
        </>
      }
    >
      <p className="px-5 py-4 text-sm text-ink-muted">
        Are you sure you want to mark “{projectName}” as <span className="font-medium text-ink">Finish</span>? This
        locks the project details for everyone — they can no longer be edited — and the project cannot be set back
        to On Progress.
      </p>
    </Modal>
  );
}
