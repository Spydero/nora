import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Alert, Button, cn } from "@nora/ui";

export function PageShell({
  title,
  description,
  actions,
  width = "default",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: "narrow" | "default" | "wide";
  children: ReactNode;
}) {
  return (
    <main className={cn("mx-auto flex flex-col gap-5 p-4 md:p-6", width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-[1400px]" : "max-w-5xl")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-secondary text-fg-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-8 text-secondary text-fg-muted">
      <Loader2 aria-hidden className="size-4 animate-spin text-brand-teal" />
      {label}
    </p>
  );
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert status="danger" title="This could not be loaded">
      <p>{error.message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-subtle text-brand-teal">{icon}</span>
      <p className="text-card-title font-semibold">{title}</p>
      {children && <div className="max-w-md text-secondary text-fg-muted">{children}</div>}
    </div>
  );
}

export function SectionTitle({ id, children, actions }: { id?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={id} className="text-panel-title font-semibold">
        {children}
      </h2>
      {actions}
    </div>
  );
}

export const selectClass = "min-h-11 rounded-control border border-line-strong bg-panel px-3 text-body text-fg";
export const textareaClass = "min-h-24 w-full rounded-control border border-line-strong bg-panel px-3 py-2 text-body text-fg placeholder:text-fg-muted";
