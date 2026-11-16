import { useEffect, useRef, type ReactNode } from 'react';
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

// Nested modals (e.g. a delete confirmation opened from the edit modal) are
// stacked. Only the topmost dialog handles Escape and owns the focus trap, so
// closing the inner confirm can never also close its parent.
const modalStack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

// Shared modal shell: portal, overlay, header (eyebrow + title + close), a
// scrollable body and a pinned footer so Save/Cancel stay visible in long
// modals. Callers control body padding.
//
// Keyboard behaviour (WCAG 2.2): focus moves into the dialog on open, Tab is
// trapped inside it, Escape closes it, and focus returns to the element that
// opened it on close. Background scrolling is locked while a modal is open.
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Symbol('modal'));
  // Callers pass an inline arrow, so keep the latest handler in a ref: the
  // mount effect below must not re-subscribe (which would break the stack).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = idRef.current;
    modalStack.push(id);

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog (the close button is first in DOM order) so
    // screen readers announce it and Tab starts inside the modal.
    const raf = requestAnimationFrame(() => {
      const [first] = focusableIn(dialogRef.current);
      (first ?? dialogRef.current)?.focus({ preventScroll: true });
    });

    // Tab is trapped in the capture phase so focus can never escape the
    // topmost dialog (no viewport control needs to intercept Tab).
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (modalStack[modalStack.length - 1] !== id) return;

      const items = focusableIn(dialogRef.current);
      if (items.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && !!dialogRef.current?.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Escape is handled in the bubble phase so a control inside the dialog can
    // consume it first (e.g. closing only an open combobox/dropdown). React
    // delegates events on the root container, which is below `document`, so an
    // inner `e.stopPropagation()` reliably suppresses this handler.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== id) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDownCapture, true);
      document.removeEventListener('keydown', onKeyDown);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      if (modalStack.length === 0) document.body.style.overflow = previousOverflow;
      // Return focus to the trigger, unless it was unmounted in the meantime.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div
      className={cn('fixed inset-0 flex items-center justify-center bg-black/40 p-4', overlayClassName)}
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-lg bg-surface shadow-overlay focus:outline-none',
          maxWidthClass,
        )}
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
            className="rounded p-1.5 text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
