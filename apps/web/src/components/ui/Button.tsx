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
  primary: 'border border-transparent bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-border bg-surface text-ink hover:bg-canvas',
  ghost: 'border border-transparent bg-transparent text-ink-muted hover:bg-canvas',
  danger: 'border border-transparent bg-danger text-white hover:opacity-90',
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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
});
