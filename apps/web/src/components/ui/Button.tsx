import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-accent text-white shadow-sm hover:bg-accent-hover hover:shadow-glow active:translate-y-px',
  secondary: 'border border-border bg-surface text-ink hover:border-brand-200 hover:bg-brand-50',
  ghost: 'border border-transparent bg-transparent text-ink-muted hover:bg-brand-50 hover:text-ink',
  danger: 'border border-transparent bg-danger text-white shadow-sm hover:opacity-90 active:translate-y-px',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

// Shared button. Preserves any aria-*/title/data-testid passed through. The
// focus ring is consistent across every interactive element (a11y).
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
});
