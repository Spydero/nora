import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from './cn.ts';

export type Status = 'success' | 'warning' | 'danger' | 'info';

const styles: Record<Status, { className: string; Icon: typeof Info }> = {
  success: { className: 'bg-success-bg text-success', Icon: CheckCircle2 },
  warning: { className: 'bg-warning-bg text-warning', Icon: AlertTriangle },
  danger: { className: 'bg-danger-bg text-danger', Icon: OctagonAlert },
  info: { className: 'bg-info-bg text-info', Icon: Info },
};

export function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  const { className, Icon } = styles[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-secondary font-medium', className)}>
      <Icon aria-hidden className="size-4" strokeWidth={2} />
      {children}
    </span>
  );
}

export function Alert({ status, title, children }: { status: Status; title: ReactNode; children?: ReactNode }) {
  const { className, Icon } = styles[status];
  return (
    <div role={status === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-card p-4', className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
      <div className="text-body">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-fg">{children}</div>}
      </div>
    </div>
  );
}
