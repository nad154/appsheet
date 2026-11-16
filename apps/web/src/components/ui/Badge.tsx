import type { ReactNode } from 'react';
import { cn } from './cn';

type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

const VARIANT: Record<BadgeVariant, string> = {
  neutral: 'bg-canvas text-ink-muted ring-1 ring-inset ring-border',
  info: 'bg-info-soft text-info ring-1 ring-inset ring-info/20',
  success: 'bg-success-soft text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/20',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
};

// Soft pill badge, replacing the separate stage / priority / flag styles.
export function Badge({ variant = 'neutral', children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
