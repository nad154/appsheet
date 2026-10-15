import type { ReactNode } from 'react';
import { cn } from './cn';

type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

const VARIANT: Record<BadgeVariant, string> = {
  neutral: 'bg-canvas text-ink-muted',
  info: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
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
