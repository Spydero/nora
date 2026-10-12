"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, Check, ChevronRight, FileText, History, MessageCircleQuestion, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Card, cn, Panel, StatusBadge } from "@nora/ui";
import { formatDate, URGENCY_LABEL } from "@/lib/care";
import { type CarePlanItem, checksApi, type CheckView, type MemoryItem, TERMINAL } from "@/lib/checks";
import type { CheckController } from "@/lib/use-check";
import { useLoad } from "@/lib/use-load";
import { URGENCY_STATUS } from "./findings-panel";

export function NextStepsPanel({ controller, className }: { controller: CheckController; className?: string }) {
  const { check } = controller;
  const result = check?.result;
  return (
    <Panel title="Next steps" titleId="next-title" className={className}>
      {result && check ? <ResultSteps check={check} controller={controller} /> : <Remembered check={check} onOpen={(id) => void controller.open(id)} />}
    </Panel>
  );
}

const isWatch = (i: CarePlanItem) => i.watch ?? i.kind === "monitoring";

function ResultSteps({ check, controller }: { check: CheckView; controller: CheckController }) {
  const result = check.result!;
  const done = new Set(check.carePlanDone);
  const finished = TERMINAL.includes(check.status);
  if (result.urgency.level === "emergency") {
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-start gap-2 text-body">
          <Phone aria-hidden className="mt-1 size-4 shrink-0 text-danger" />
          Follow the emergency advice at the top of the page first. Nothing else here needs doing until you’ve got help.
        </p>
        {result.carePlan
          .filter((i) => i.kind !== "urgent_action")
          .map((i) => (
            <Card key={i.id}>
              <p className="text-body">{i.text}</p>
            </Card>
          ))}
      </div>
    );
  }
  const tasks = result.carePlan.filter((i) => !isWatch(i) && !i.whileWaiting);
  const comfort = result.carePlan.filter((i) => !isWatch(i) && i.whileWaiting);
  const watch = result.carePlan.filter(isWatch);
  const seeDoctor = result.handoff.recommended ? tasks.find((i) => i.kind === "handoff" || i.kind === "urgent_action") : undefined;
  const findDoctor = result.handoff.recommended && (
    <Link
      href={`/doctors?${new URLSearchParams({ ...(result.handoff.specialty ? { specialty: result.handoff.specialty } : {}), check: check.id }).toString()}`}
      className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline"
    >
      Find a {result.handoff.specialty ? result.handoff.specialty.toLowerCase() : "doctor"}
    </Link>
  );
  const allTasks = [...tasks, ...comfort];
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="plan-h" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="plan-h" className="text-card-title font-semibold">
            Your care plan
          </h3>
          {allTasks.length > 1 && (
            <span className="text-meta text-fg-muted">
              {allTasks.filter((i) => done.has(i.id)).length} of {allTasks.length} done
            </span>
          )}
        </div>
        <TaskList items={tasks} done={done} controller={controller} highlight={tasks[0]?.id} extra={seeDoctor ? { id: seeDoctor.id, node: findDoctor } : undefined} />
        {!seeDoctor && findDoctor}
        {comfort.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <h4 className="font-semibold">Until you’re seen</h4>
            <p className="text-meta text-fg-muted">These may ease discomfort while you wait. They don’t replace seeing a doctor.</p>
            <TaskList items={comfort} done={done} controller={controller} />
          </div>
        )}
        <p className="text-meta text-fg-muted">Ticking items off is just for you. It doesn’t change Nora’s advice.</p>
      </section>

      {watch.length > 0 && (
        <section aria-labelledby="watch-h" className="flex flex-col gap-2 rounded-card bg-warning-bg p-4">
          <h3 id="watch-h" className="flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle aria-hidden className="size-5" />
            Get help sooner if
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-secondary text-fg">
            {watch.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </section>
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

      {finished && (
        <Card className="flex flex-col gap-2 border-brand-teal">
          <p className="flex items-center gap-2 font-semibold">
            <FileText aria-hidden className="size-5 text-brand-teal" />
            Summary for your doctor
          </p>
          <p className="text-secondary text-fg-muted">
            Your symptoms, history, medicines and Nora’s findings on one page. Check and edit it, then download or print it to take to your appointment.
          </p>
          <Link href={`/summary/${check.id}`} className="self-start text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
            Open the summary
          </Link>
        </Card>
      )}

      {finished && (
        <Card className="flex flex-col gap-2">
          <p className="font-semibold">Symptoms changed?</p>
          <p className="text-secondary text-fg-muted">Start a follow-up check. Nora will link it to this one so you and your doctor can compare.</p>
          <Button variant="secondary" className="self-start" onClick={controller.recheck}>
            <RefreshCw aria-hidden className="size-4" />
            Recheck my symptoms
          </Button>
        </Card>
      )}
    </div>
  );
}

function TaskList({
  items,
  done,
  controller,
  highlight,
  extra,
}: {
  items: CarePlanItem[];
  done: Set<string>;
  controller: CheckController;
  highlight?: string;
  extra?: { id: string; node: ReactNode };
}) {
  if (items.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => {
        const checked = done.has(item.id);
        return (
          <li key={item.id}>
            <Card className={cn("flex gap-3", item.id === highlight && "border-brand-teal", checked && "bg-subtle")}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => void controller.acknowledge(item.id, event.target.checked)}
                aria-label={`Mark done: ${item.text}`}
                className="mt-1 size-4 shrink-0 accent-brand-teal"
              />
              <div className="flex flex-col gap-1">
                <p className={cn("text-body", checked && "text-fg-muted line-through decoration-fg-muted/60")}>{item.text}</p>
                {item.timeframe && (
                  <p className="inline-flex items-center gap-1 text-meta font-medium text-fg-muted">
                    <CalendarClock aria-hidden className="size-3.5" />
                    {item.timeframe}
                  </p>
                )}
                {extra?.id === item.id && extra.node}
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

const RECORD_GROUPS: { kind: MemoryItem["kind"]; label: string }[] = [
  { kind: "condition", label: "Conditions" },
  { kind: "medicine", label: "Medicines" },
  { kind: "allergy", label: "Allergies" },
];

/** What Nora will take into account, all from records the patient confirmed. */
function Remembered({ check, onOpen }: { check: CheckView | null; onOpen(id: string): void }) {
  const { data, error } = useLoad(checksApi.memory, check?.id ?? "");
  const items = data?.items ?? [];
  const records = items.filter((m) => RECORD_GROUPS.some((g) => g.kind === m.kind));
  const pastChecks = items.filter((m) => m.kind === "past_check" && m.checkId !== check?.id).slice(0, 3);
  const upcoming = items.filter((m) => m.kind === "appointment");

  if (error) return <p className="text-secondary text-fg-muted">Nora couldn’t load your records just now.</p>;
  if (!data) return <p className="text-secondary text-fg-muted">Loading your records…</p>;

  return (
    <div className="flex flex-col gap-4">
      {check?.parent && (
        <Card className="flex flex-col gap-1 border-brand-teal">
          <p className="text-meta font-medium text-fg-muted">Following up</p>
          <p className="font-semibold">{check.parent.title ?? "Earlier check"}</p>
          <p className="text-secondary text-fg-muted">
            {formatDate(check.parent.createdAt)}
            {check.parent.urgencyTitle ? ` · ${check.parent.urgencyTitle}` : ""}
          </p>
        </Card>
      )}

      <section aria-labelledby="remember-h" className="flex flex-col gap-2">
        <h3 id="remember-h" className="flex items-center gap-2 text-card-title font-semibold">
          <ShieldCheck aria-hidden className="size-5 text-brand-teal" />
          {check ? "Nora is taking into account" : "What Nora remembers"}
        </h3>
        {records.length > 0 ? (
          <Card className="flex flex-col gap-2">
            <dl className="flex flex-col gap-2">
              {RECORD_GROUPS.map((g) => {
                const values = records.filter((m) => m.kind === g.kind).map((m) => m.text);
                if (values.length === 0) return null;
                return (
                  <div key={g.kind}>
                    <dt className="text-meta font-medium text-fg-muted">{g.label}</dt>
                    <dd className="text-body">{values.join(", ")}</dd>
                  </div>
                );
              })}
            </dl>
            <Link href="/settings" className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
              Update your records
            </Link>
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            <p className="text-secondary">Add your conditions, medicines and allergies so Nora can take them into account and flag what your doctor needs to know.</p>
            <Link href="/settings" className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
              Add health records
            </Link>
          </Card>
        )}
        <p className="text-meta text-fg-muted">Nora only uses records you’ve confirmed. It never guesses your history.</p>
      </section>

      {!check && pastChecks.length > 0 && (
        <section aria-labelledby="recent-h" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 id="recent-h" className="flex items-center gap-2 text-card-title font-semibold">
              <History aria-hidden className="size-5 text-brand-teal" />
              Recent checks
            </h3>
            <Link href="/history" className="text-meta font-medium text-brand-teal underline-offset-2 hover:underline">
              All checks
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {pastChecks.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => m.checkId && onOpen(m.checkId)}
                  className="flex w-full items-center gap-3 rounded-card border border-line p-3 text-left hover:border-brand-teal"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-secondary">{m.text}</span>
                    {m.urgency && (
                      <span className="mt-1 block">
                        <StatusBadge status={URGENCY_STATUS[m.urgency]}>{URGENCY_LABEL[m.urgency]}</StatusBadge>
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-h" className="flex flex-col gap-2">
          <h3 id="upcoming-h" className="flex items-center gap-2 text-card-title font-semibold">
            <CalendarClock aria-hidden className="size-5 text-brand-teal" />
            Coming up
          </h3>
          {upcoming.map((m) => (
            <Card key={m.id} className="flex flex-col gap-1">
              <p className="text-body">{m.text}</p>
              <Link href={m.href} className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
                <Check aria-hidden className="mr-1 inline size-4" />
                Manage appointments
              </Link>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
