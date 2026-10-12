import { useId, type InputHTMLAttributes } from 'react';
import { cn } from './cn.ts';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, className, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-secondary font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-meta text-fg-muted">
          {hint}
        </p>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'min-h-11 rounded-control border bg-panel px-3 text-body text-fg placeholder:text-fg-muted',
          error ? 'border-danger' : 'border-line-strong',
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
