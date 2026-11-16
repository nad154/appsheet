import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

// Neutral empty state for grids, dashboards and lists.
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`relative flex flex-col items-center justify-center gap-2 py-10 text-center ${className ?? ''}`}>
      {icon != null && (
        <div className="relative mb-1 flex items-center justify-center">
          <div
            className="pointer-events-none absolute inset-0 -m-6 bg-dot-pattern bg-dots opacity-60"
            aria-hidden="true"
          />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            {icon}
          </div>
        </div>
      )}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {description != null && <p className="max-w-sm text-xs text-ink-muted/80">{description}</p>}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
