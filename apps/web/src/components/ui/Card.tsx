import type { ReactNode } from 'react';
import { cn } from './cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  // Optional header. `title`/`subtitle` render a titled header; `actions`
  // sits right-aligned on the same row.
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function Card({ children, className, title, subtitle, actions }: CardProps) {
  const hasHeader = title != null || subtitle != null || actions != null;
  return (
    <section className={cn('rounded-lg border border-border bg-surface shadow-card', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            {title != null && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle != null && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
