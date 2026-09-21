import { createPortal } from 'react-dom';

interface StageConfirmModalProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function StageConfirmModal({ projectName, onConfirm, onCancel, busy }: StageConfirmModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm finish stage"
      >
        <h2 className="text-base font-semibold text-gray-800">Mark project as Finish?</h2>
        <p className="mt-2 text-sm text-gray-600">
          Are you sure you want to mark “{projectName}” as <span className="font-medium">Finish</span>? A finished
          project cannot be set back to On Progress.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Marking…' : 'Mark as Finish'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}