import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-teal text-fg-inverse hover:bg-brand-teal-hover',
  secondary: 'bg-panel text-fg border border-line hover:bg-subtle',
  ghost: 'bg-transparent text-fg hover:bg-subtle',
  danger: 'bg-danger text-fg-inverse hover:brightness-95',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-4 text-body font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-5 animate-spin" strokeWidth={2} />}
      {children}
    </button>
  );
}
