import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface PermanentDeleteConfirmModalProps {
  // 'user' / 'market segment' — used in the title and confirm button.
  entityLabel: string;
  name: string;
  // What the delete touches (and what it leaves behind), shown before the
  // admin commits. The GET .../usage endpoint feeds these counts.
  impacts: string[];
  error?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Blocking confirmation for the SUPER_ADMIN-only permanent deletes on the
// Settings page (users, market segments). The server enforces the two-step
// rule (row must be deactivated first), so this modal is the final warning —
// it spells out what is removed, what keeps referencing the row, and that the
// action cannot be undone.
export function PermanentDeleteConfirmModal({
  entityLabel,
  name,
  impacts,
  error,
  busy,
  onConfirm,
  onCancel,
}: PermanentDeleteConfirmModalProps) {
  return (
    <Modal
      ariaLabel="Confirm permanent delete"
      title={`Delete ${entityLabel} permanently?`}
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
            data-testid="confirm-permanent-delete"
          >
            {busy ? 'Deleting…' : `Delete ${entityLabel}`}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <p className="text-sm text-ink-muted">
          “<span className="font-medium text-ink">{name}</span>” will be permanently removed.
        </p>
        {impacts.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-ink-muted">This action cannot be undone.</p>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
