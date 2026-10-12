"use client";

import { useState, type ReactNode } from "react";
import { ClipboardList, FileSearch, ListChecks, Send } from "lucide-react";
import { Button, Card, cn, Panel, StatusBadge } from "@nora/ui";
import { useAuth } from "@/lib/auth-context";
import { firstName } from "@/lib/names";

type View = "intake" | "findings" | "next";

const VIEWS: { id: View; label: string }[] = [
  { id: "intake", label: "Intake" },
  { id: "findings", label: "Findings" },
  { id: "next", label: "Next steps" },
];

export default function WorkspacePage() {
  const { state } = useAuth();
  const [view, setView] = useState<View>("intake");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const givenName = state.profile ? firstName(state.profile.user.displayName) : undefined;

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1600px] max-md:h-[calc(100dvh-8rem)] flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold">Hello{givenName ? `, ${givenName}` : ""}</h1>
          <p className="text-secondary text-fg-muted">Describe what you are experiencing and Nora will ask a few questions.</p>
        </div>
        <Button variant="secondary" className="xl:hidden max-md:hidden" onClick={() => setDrawerOpen(true)}>
          <ListChecks aria-hidden className="size-5" />
          Next steps
        </Button>
      </div>

      <div role="tablist" aria-label="Workspace views" className="grid grid-cols-3 gap-1 rounded-control bg-subtle p-1 md:hidden">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "min-h-11 rounded-control text-secondary font-medium",
              view === item.id ? "bg-panel text-brand-navy shadow-sm" : "text-fg-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[28fr_44fr] xl:grid-cols-[28fr_44fr_28fr]">
        <IntakePanel className={cn(view !== "intake" && "max-md:hidden")} />
        <FindingsPanel className={cn(view !== "findings" && "max-md:hidden")} />
        <NextStepsPanel className={view === "next" ? "md:max-xl:hidden" : "max-xl:hidden"} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-30 hidden bg-brand-navy/30 md:block xl:hidden" onClick={() => setDrawerOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Next steps"
            className="absolute inset-y-0 right-0 flex w-[min(420px,90vw)] flex-col bg-canvas p-4 shadow-overlay"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex justify-end">
              <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </div>
            <NextStepsPanel className="flex-1" />
          </div>
        </div>
      )}
    </main>
  );
}

function IntakePanel({ className }: { className?: string }) {
  return (
    <Panel title="Intake" titleId="intake-title" className={className}>
      <div className="flex h-full flex-col">
        <div className="flex-1">
          <EmptyState
            icon={<ClipboardList aria-hidden className="size-6" />}
            title="Start a check"
            body='Describe your main symptom in your own words, for example: "Sore throat and fever since yesterday."'
          />
        </div>
        <form className="mt-4 flex flex-col gap-2" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="symptom" className="text-secondary font-medium">
            What would you like help with?
          </label>
          <textarea
            id="symptom"
            rows={3}
            maxLength={8000}
            disabled
            placeholder="Symptom intake arrives with F04"
            className="resize-none rounded-control border border-line-strong bg-panel p-3 text-body placeholder:text-fg-muted disabled:bg-subtle"
          />
          <Button type="submit" disabled className="self-end">
            <Send aria-hidden className="size-4" />
            Continue
          </Button>
        </form>
      </div>
    </Panel>
  );
}

function FindingsPanel({ className }: { className?: string }) {
  return (
    <Panel title="Findings" titleId="findings-title" className={className} actions={<StatusBadge status="info">No assessment yet</StatusBadge>}>
      <EmptyState
        icon={<FileSearch aria-hidden className="size-6" />}
        title="Your assessment will appear here"
        body="Based on the information you provide, Nora shows possible explanations, how certain they are, and the sources used."
      />
    </Panel>
  );
}

function NextStepsPanel({ className }: { className?: string }) {
  return (
    <Panel title="Next steps" titleId="next-title" className={className}>
      <div className="flex flex-col gap-3">
        <Card>
          <p className="text-card-title font-semibold">Urgent symptoms</p>
          <p className="mt-1 text-secondary text-fg-muted">
            If you have severe chest pain, trouble breathing, or signs of a stroke, call your local emergency number now.
          </p>
        </Card>
        <EmptyState
          icon={<ListChecks aria-hidden className="size-6" />}
          title="Care plan"
          body="Recommended actions, timeframes and doctors will be listed here after your assessment."
        />
      </div>
    </Panel>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-4">
      <span className="grid size-10 place-items-center rounded-control bg-subtle text-brand-teal">{icon}</span>
      <p className="text-card-title font-semibold">{title}</p>
      <p className="text-secondary text-fg-muted">{body}</p>
    </div>
  );
}
