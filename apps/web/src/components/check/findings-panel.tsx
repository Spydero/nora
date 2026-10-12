"use client";

import { FileSearch, Loader2 } from "lucide-react";
import { Alert, Card, cn, Panel, StatusBadge, type Status } from "@nora/ui";
import type { CheckResult, CheckView, UrgencyLevel } from "@/lib/checks";
import { EmptyState } from "./intake-panel";

export const URGENCY_STATUS: Record<UrgencyLevel, Status> = {
  emergency: "danger",
  urgent: "danger",
  soon: "warning",
  routine: "info",
  self_care: "success",
};

const LIKELIHOOD: Record<CheckResult["explanations"][number]["likelihood"], { label: string; className: string }> = {
  more_likely: { label: "More likely", className: "bg-brand-navy text-fg-inverse" },
  possible: { label: "Possible", className: "bg-subtle text-fg" },
  less_likely: { label: "Less likely", className: "border border-line text-fg-muted" },
};

const GENERATOR: Record<CheckResult["generator"], string> = {
  llm: "Explanations written by AI from approved sources, then checked by Nora’s safety rules.",
  template: "Nora’s standard approved guidance.",
  template_fallback: "Nora’s standard approved guidance (the AI explanation did not pass safety checks).",
  rules: "Safety rules decided this result; no AI was used.",
};

const RESULT_BADGE: Record<CheckResult["status"], string> = {
  COMPLETED: "Assessed",
  INCOMPLETE: "Incomplete",
  ESCALATED: "Assessed",
  UNSUPPORTED: "Not covered yet",
};

export function FindingsPanel({ check, className }: { check: CheckView | null; className?: string }) {
  const result = check?.result;
  const badge = result ? (
    <StatusBadge status={URGENCY_STATUS[result.urgency.level]}>{RESULT_BADGE[result.status]}</StatusBadge>
  ) : check?.status === "ASSESSING" ? (
    <StatusBadge status="info">Working…</StatusBadge>
  ) : check ? (
    <StatusBadge status="info">Collecting details</StatusBadge>
  ) : (
    <StatusBadge status="info">No assessment yet</StatusBadge>
  );

  return (
    <Panel title="Findings" titleId="findings-title" className={className} actions={badge}>
      {!result ? (
        check?.status === "ASSESSING" && check.turnCount > 0 ? (
          <p role="status" className="flex items-center gap-2 text-secondary text-fg-muted">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Nora is reviewing your answers…
          </p>
        ) : (
          <EmptyState
            icon={<FileSearch aria-hidden className="size-6" />}
            title="Your assessment will appear here"
            body="Based on the information you provide, Nora shows possible explanations, how certain they are, and the sources used."
          />
        )
      ) : (
        <ResultView result={result} />
      )}
    </Panel>
  );
}

function ResultView({ result }: { result: CheckResult }) {
  const status = URGENCY_STATUS[result.urgency.level];
  return (
    <div className="flex flex-col gap-4">
      <Alert status={status} title={result.urgency.title}>
        <p>{result.urgency.text}</p>
        {result.urgency.reasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-secondary">
            {result.urgency.reasons.map((r) => (
              <li key={r.ruleId}>
                {r.message} <Citations ids={r.citations} />
              </li>
            ))}
          </ul>
        )}
      </Alert>

      <section aria-labelledby="summary-h">
        <h3 id="summary-h" className="text-card-title font-semibold">
          Summary
        </h3>
        <p className="mt-1 text-body">{result.summary}</p>
      </section>

      {result.explanations.length > 0 && (
        <section aria-labelledby="expl-h" className="flex flex-col gap-2">
          <h3 id="expl-h" className="text-card-title font-semibold">
            Possible explanations
          </h3>
          <p className="text-meta text-fg-muted">These are possibilities to discuss with a doctor, not a diagnosis.</p>
          {result.explanations.map((e) => (
            <Card key={e.code} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{e.label}</p>
                <span className={cn("rounded-control px-2 py-0.5 text-meta font-medium", LIKELIHOOD[e.likelihood].className)}>{LIKELIHOOD[e.likelihood].label}</span>
              </div>
              <p className="text-secondary text-fg-muted">{e.plain}</p>
              <p className="text-secondary">
                {e.rationale.replace(/\s*\(?\bE\d+\b(,\s*E\d+)*\)?/g, "")} <Citations ids={e.citations} />
              </p>
            </Card>
          ))}
        </section>
      )}

      <section aria-labelledby="told-h" className="flex flex-col gap-2">
        <h3 id="told-h" className="text-card-title font-semibold">
          What you told Nora
        </h3>
        <FactChips label="You have" items={result.findings.present} tone="present" />
        <FactChips label="You don’t have" items={result.findings.absent} tone="absent" />
        <FactChips label="Not answered" items={result.findings.unknown} tone="unknown" />
      </section>

      {result.limitations
        .filter((l) => l !== result.summary)
        .map((l) => (
          <Alert key={l} status="info" title="Please note">
            {l}
          </Alert>
        ))}

      {result.evidence.length > 0 && (
        <section aria-labelledby="src-h">
          <h3 id="src-h" className="text-card-title font-semibold">
            Sources
          </h3>
          <ol className="mt-2 flex flex-col gap-2">
            {result.evidence.map((e) => (
              <li key={e.citationId} id={`src-${e.citationId}`} className="scroll-mt-4 rounded-card border border-line p-3 target:border-brand-teal">
                <details>
                  <summary className="cursor-pointer text-secondary">
                    <span className="font-semibold">[{e.citationId}]</span> {e.title}
                    {e.heading ? ` — ${e.heading}` : ""} <span className="text-fg-muted">· {e.publisher}</span>
                  </summary>
                  <p className="mt-2 text-secondary text-fg-muted">{e.excerpt}</p>
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="border-t border-line pt-3 text-meta text-fg-muted">
        {GENERATOR[result.generator]}
        {result.model ? ` Model: ${result.model}.` : ""} {result.disclaimer}
      </p>
    </div>
  );
}

function Citations({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => (
        <a key={id} href={`#src-${id}`} className="rounded-control bg-info-bg px-1.5 text-meta font-medium text-info hover:underline" aria-label={`Source ${id}`}>
          {id}
        </a>
      ))}
    </span>
  );
}

function amount(value: number, unit: string | undefined): string {
  if (!unit) return String(value);
  if (unit === "days" && value === 0) return "less than a day";
  return `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;
}

function FactChips({ label, items, tone }: { label: string; items: CheckResult["findings"]["present"]; tone: "present" | "absent" | "unknown" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-meta font-medium text-fg-muted">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {items.map((f) => (
          <li
            key={f.key}
            className={cn(
              "rounded-control px-2 py-0.5 text-secondary",
              tone === "present" && "bg-subtle text-fg",
              tone === "absent" && "border border-line text-fg-muted",
              tone === "unknown" && "border border-dashed border-line text-fg-muted",
            )}
          >
            {f.label}
            {f.value !== undefined && f.value !== null ? `: ${amount(f.value, f.unit)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
