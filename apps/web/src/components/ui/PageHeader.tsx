import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  variant?: 'banner' | 'minimal';
}

// Shared page title block. The banner variant is the default; Grid opts into
// the compact minimal variant so the table keeps as much vertical space as
// possible. All new props are optional, so existing call sites keep working.
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  variant = 'banner',
}: PageHeaderProps) {
  const body = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow != null && (
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-brand-600">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-semibold leading-7 tracking-tight text-ink">{title}</h1>
        {variant === 'minimal' && (
          <span aria-hidden="true" className="mt-1.5 block h-1 w-10 rounded-full bg-brand-gradient" />
        )}
        {description != null && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        {meta != null && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );

  if (variant === 'minimal') {
    return <div className="mb-4 border-b border-border pb-3">{body}</div>;
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-border bg-brand-soft px-5 py-4 shadow-card">
      <span aria-hidden="true" className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-brand-gradient" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 bg-dot-pattern bg-dots opacity-40 [mask-image:linear-gradient(to_left,black,transparent)] sm:block"
      />
      <div className="relative">{body}</div>
    </div>
  );
}
