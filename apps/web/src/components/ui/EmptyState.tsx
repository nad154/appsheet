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
    <div className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className ?? ''}`}>
      {icon != null && <div className="text-ink-muted/60">{icon}</div>}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {description != null && <p className="max-w-sm text-xs text-ink-muted/80">{description}</p>}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
