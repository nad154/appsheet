import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

// Page title row: title (and optional description) on the left, actions on the
// right. Used by Grid, Dashboard, Settings and Drive Browser.
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold leading-7 text-ink">{title}</h1>
        {description != null && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
