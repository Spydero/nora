"use client";

import Link from "next/link";
import { CalendarClock, ListChecks, MessageCircleQuestion, Phone, Stethoscope } from "lucide-react";
import { Card, cn, Panel } from "@nora/ui";
import type { CheckView, EmergencyContacts } from "@/lib/checks";
import { EmptyState } from "./intake-panel";

const KIND_ICON: Record<string, typeof ListChecks> = { urgent_action: Phone, handoff: Stethoscope };

export function NextStepsPanel({ check, emergency, className }: { check: CheckView | null; emergency: EmergencyContacts; className?: string }) {
  const result = check?.result;
  return (
    <Panel title="Next steps" titleId="next-title" className={className}>
      <div className="flex flex-col gap-3">
        {result ? (
          <>
            <ol aria-label="Care plan" className="flex flex-col gap-2">
              {result.carePlan.map((item, i) => {
                const Icon = KIND_ICON[item.kind] ?? ListChecks;
                return (
                  <li key={item.id}>
                    <Card className={cn("flex gap-3", i === 0 && "border-brand-teal")}>
                      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-teal" />
                      <div className="flex flex-col gap-1">
                        <p className="text-body">{item.text}</p>
                        {item.timeframe && (
                          <p className="inline-flex items-center gap-1 text-meta font-medium text-fg-muted">
                            <CalendarClock aria-hidden className="size-3.5" />
                            {item.timeframe}
                          </p>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>

            {result.handoff.recommended && result.urgency.level !== "emergency" && (
              <Card className="flex flex-col gap-2 bg-subtle">
                <p className="font-semibold">
                  See {result.handoff.specialty ? `a ${result.handoff.specialty.toLowerCase()}` : "a doctor"} · {result.handoff.timeframe}
                </p>
                <Link href="/doctors" className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
                  Find a doctor near you
                </Link>
              </Card>
            )}

            {result.questionsForClinician.length > 0 && (
              <section aria-labelledby="ask-h" className="flex flex-col gap-1">
                <h3 id="ask-h" className="flex items-center gap-2 text-card-title font-semibold">
                  <MessageCircleQuestion aria-hidden className="size-5 text-brand-teal" />
                  Questions to ask your doctor
                </h3>
                <ul className="list-disc pl-5 text-secondary">
                  {result.questionsForClinician.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <>
            <Card>
              <p className="text-card-title font-semibold">Urgent symptoms</p>
              <p className="mt-1 text-secondary text-fg-muted">
                If you have severe chest pain, trouble breathing, or signs of a stroke, call{" "}
                <a href={`tel:${emergency.number}`} className="font-semibold text-danger underline">
                  {emergency.number}
                </a>{" "}
                now.
              </p>
              {emergency.crisisLine && (
                <p className="mt-2 text-secondary text-fg-muted">
                  If you are thinking about harming yourself, call {emergency.crisisLine.name} on{" "}
                  <a href={`tel:${emergency.crisisLine.number}`} className="font-semibold text-brand-teal underline">
                    {emergency.crisisLine.number}
                  </a>
                  , free and available 24×7.
                </p>
              )}
            </Card>
            <EmptyState
              icon={<ListChecks aria-hidden className="size-6" />}
              title="Care plan"
              body="Recommended actions, timeframes and doctors will be listed here after your assessment."
            />
          </>
        )}
      </div>
    </Panel>
  );
}
