import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, AlertIcon, CloseIcon } from './ui/icons';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const VARIANT: Record<ToastVariant, { border: string; icon: ReactNode; tone: string }> = {
  success: { border: 'border-l-success', tone: 'text-success', icon: <CheckIcon size={16} /> },
  error: { border: 'border-l-danger', tone: 'text-danger', icon: <AlertIcon size={16} /> },
  info: { border: 'border-l-accent', tone: 'text-accent', icon: <AlertIcon size={16} /> },
};

const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const v = VARIANT[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border border-border border-l-4 bg-surface px-4 py-3 text-sm text-ink shadow-overlay animate-[toast-in_0.18s_ease-out] ${v.border}`}
            >
              <span className={`mt-0.5 shrink-0 ${v.tone}`}>{v.icon}</span>
              <span className="flex-1 leading-snug">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-ink-muted transition-colors hover:text-ink"
                aria-label="Dismiss notification"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
