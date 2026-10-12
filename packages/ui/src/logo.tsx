import { cn } from './cn.ts';

export function NoraMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className={className}>
      <rect width="48" height="48" rx="12" fill="var(--color-brand-navy)" />
      <path
        d="M15 33V15l18 18V15"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33" cy="15" r="3.25" fill="var(--color-brand-cyan)" />
    </svg>
  );
}

export function NoraLogo({ descriptor = true, className }: { descriptor?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <NoraMark size={32} />
      <span className="flex items-baseline gap-2">
        <span className="text-panel-title font-semibold tracking-tight text-brand-navy">Nora</span>
        {descriptor && <span className="text-secondary text-fg-muted">Health Assistant</span>}
      </span>
    </span>
  );
}
