import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
}

export function Panel({ title, titleId, actions, className, children, ...props }: PanelProps) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn('flex min-h-0 flex-col rounded-panel border border-line bg-panel', className)}
      {...props}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-panel-title font-semibold">
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-panel p-4', className)} {...props} />;
}
