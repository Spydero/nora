"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { Button, cn } from "@nora/ui";
import { EmergencyBanner } from "@/components/check/emergency-banner";
import { FindingsPanel } from "@/components/check/findings-panel";
import { IntakePanel } from "@/components/check/intake-panel";
import { NextStepsPanel } from "@/components/check/next-steps-panel";
import { useAuth } from "@/lib/auth-context";
import { firstName } from "@/lib/names";
import { useCheck } from "@/lib/use-check";

type View = "intake" | "findings" | "next";

const VIEWS: { id: View; label: string }[] = [
  { id: "intake", label: "Intake" },
  { id: "findings", label: "Findings" },
  { id: "next", label: "Next steps" },
];

const FALLBACK_EMERGENCY = { number: "112", crisisLine: null };

export default function WorkspacePage() {
  const { state } = useAuth();
  const controller = useCheck();
  const { check } = controller;
  const [view, setView] = useState<View>("intake");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const givenName = state.profile ? firstName(state.profile.user.displayName) : undefined;
  const emergency = check?.emergency ?? state.profile?.tenant.emergency ?? FALLBACK_EMERGENCY;
  const isEmergency = check?.urgency === "emergency";
  const shownKey = `${check?.id ?? ""}:${check?.result?.createdAt ?? ""}`;
  const [seenKey, setSeenKey] = useState(shownKey);
  if (seenKey !== shownKey) {
    setSeenKey(shownKey);
    if (!check) setView("intake");
    else if (check.result && typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setView("findings");
  }
  const [findingsSeenKey, setFindingsSeenKey] = useState<string | null>(null);
  if (view === "findings" && check?.result && findingsSeenKey !== shownKey) setFindingsSeenKey(shownKey);
  const unseenResult = !!check?.result && view !== "findings" && findingsSeenKey !== shownKey;

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] max-w-[1600px] flex-col gap-4 p-4 max-md:h-[calc(100dvh-8rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold">Hello{givenName ? `, ${givenName}` : ""}</h1>
          <p className="text-secondary text-fg-muted">
            {check?.title ? `Current check: ${check.title}` : "Describe what you are experiencing and Nora will ask a few questions."}
          </p>
        </div>
        <Button variant="secondary" className="xl:hidden max-md:hidden" onClick={() => setDrawerOpen(true)}>
          <ListChecks aria-hidden className="size-5" />
          Next steps
        </Button>
      </div>

      {isEmergency && check && <EmergencyBanner check={check} />}

      <div role="tablist" aria-label="Workspace views" className="grid grid-cols-3 gap-1 rounded-control bg-subtle p-1 md:hidden">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn("min-h-11 rounded-control text-secondary font-medium", view === item.id ? "bg-panel text-brand-navy shadow-sm" : "text-fg-muted")}
          >
            {item.label}
            {item.id === "findings" && unseenResult && <span aria-label="new" className="ml-1.5 inline-block size-2 rounded-full bg-brand-teal" />}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[28fr_44fr] xl:grid-cols-[28fr_44fr_28fr]">
        <IntakePanel
          controller={controller}
          emergency={emergency}
          className={cn(view !== "intake" && "max-md:hidden")}
          onShowFindings={() => {
            setView("findings");
            document.getElementById("findings-title")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
        <FindingsPanel check={check} className={cn(view !== "findings" && "max-md:hidden")} />
        <NextStepsPanel controller={controller} className={view === "next" ? "md:max-xl:hidden" : "max-xl:hidden"} />
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
            <NextStepsPanel controller={controller} className="flex-1" />
          </div>
        </div>
      )}
    </main>
  );
}
