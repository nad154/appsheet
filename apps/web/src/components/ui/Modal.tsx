import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import { cn } from './cn';

interface ModalProps {
  // Accessible name for the dialog. Callers keep their existing names so the
  // Playwright specs that query dialogs by name keep passing.
  ariaLabel: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // Width utility, e.g. 'max-w-4xl'. Defaults to 'max-w-lg'.
  maxWidthClass?: string;
  // Overlay z-index utility, e.g. 'z-50' or 'z-[60]' for a nested confirm.
  overlayClassName?: string;
  closeOnOverlayClick?: boolean;
}

// Shared modal shell: portal, overlay, header (eyebrow + title + close), a
// scrollable body and a pinned footer so Save/Cancel stay visible in long
// modals. Callers control body padding.
export function Modal({
  ariaLabel,
  eyebrow,
  title,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-lg',
  overlayClassName = 'z-50',
  closeOnOverlayClick = true,
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className={cn('fixed inset-0 flex items-center justify-center bg-black/40 p-4', overlayClassName)}
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="presentation"
    >
      <div
        className={cn('flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-surface shadow-overlay', maxWidthClass)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            {eyebrow != null && (
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{eyebrow}</p>
            )}
            {title != null && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close"
            title="Close"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {footer != null && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
