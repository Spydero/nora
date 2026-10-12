"use client";

import { AlertTriangle, BookOpen, FileSearch, History, Loader2, ShieldCheck, Sparkles, Stethoscope } from "lucide-react";
import { Alert, Card, cn, Panel, StatusBadge, type Status } from "@nora/ui";
import { formatDate } from "@/lib/care";
import type { CheckResult, CheckView, UrgencyLevel } from "@/lib/checks";
import { findingText, recordsShown } from "@/lib/findings";
import { EmptyState } from "./intake-panel";

export const URGENCY_STATUS: Record<UrgencyLevel, Status> = {
  emergency: "danger",
  urgent: "danger",
  soon: "warning",
  routine: "info",
  self_care: "success",
};

const GENERATOR: Record<CheckResult["generator"], string> = {
  llm: "Urgency decided by Nora’s clinical rules. Summary written by AI from what you told Nora and checked by Nora; AI can’t change the urgency.",
  template: "Urgency decided by Nora’s clinical rules. Summary in Nora’s standard wording.",
  template_fallback: "Urgency decided by Nora’s clinical rules. The AI summary was unavailable or didn’t pass Nora’s checks, so Nora’s standard wording is shown instead.",
  rules: "Nora’s clinical rules decided this result; no AI was used.",
};

const EXPLAINED_BY: Record<CheckResult["generator"], string> = {
  llm: "Written by AI · it can’t change your urgency",
  template: "Nora’s standard wording",
  template_fallback: "Nora’s standard wording",
  rules: "From Nora’s clinical rules",
};

const CONFLICT_OUTCOME: Record<NonNullable<CheckResult["answerConflicts"]>[number]["resolution"], string> = {
  treated_as_present: "Because it can be a warning sign, Nora treated it as present to be safe.",
  kept_answer: "Nora kept your answer.",
  ask_again: "Nora asked you again so it has the right answer.",
};

const SAFETY_GAP: Record<NonNullable<CheckResult["triage"]>["missingSafety"][number]["gap"], string> = {
  unsure: "you weren’t sure",
  skipped: "skipped",
  not_asked: "not asked",
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
            body="Nora will show how soon to get care, a summary of what you told it, general health information and the sources used. It does not diagnose."
          />
        )
      ) : (
        <ResultView key={result.createdAt} result={result} review={check?.review ?? null} parent={check?.parent ?? null} />
      )}
    </Panel>
  );
}

const URGENCY_TEXT: Record<UrgencyLevel, string> = {
  emergency: "emergency care now",
  urgent: "see a doctor today",
  soon: "see a doctor within 24–48 hours",
  routine: "book a routine appointment",
  self_care: "self-care at home",
};

function ClinicianReview({ review }: { review: NonNullable<CheckView["review"]> }) {
  if (review.status === "pending") {
    return (
      <p className="flex items-center gap-2 rounded-card bg-subtle px-3 py-2 text-secondary text-fg-muted">
        <Stethoscope aria-hidden className="size-4 shrink-0 text-brand-teal" />
        A clinician will look over this result. You don’t need to wait for them to act on the advice below.
      </p>
    );
  }
  const corrected = review.status === "corrected" && review.correctedUrgency;
  return (
    <Alert
      status={corrected ? URGENCY_STATUS[review.correctedUrgency!] : "info"}
      title={corrected ? `${review.clinician ?? "A clinician"} updated this advice: ${URGENCY_TEXT[review.correctedUrgency!]}` : `Reviewed by ${review.clinician ?? "a clinician"}`}
    >
      {review.patientNote && <p>“{review.patientNote}”</p>}
      <p className="mt-1 text-meta text-fg-muted">
        {corrected ? "Follow the clinician’s advice where it differs from Nora’s." : "The clinician agreed with Nora’s advice."}
        {review.reviewedAt ? ` Reviewed ${formatDate(review.reviewedAt, true)}.` : ""}
      </p>
    </Alert>
  );
}

export function ResultView({
  result,
  review,
  parent = null,
}: {
  result: CheckResult;
  review: CheckView["review"];
  parent?: CheckView["parent"];
}) {
  const status = URGENCY_STATUS[result.urgency.level];
  const information = result.information ?? [];
  const exposures = result.findings.exposures ?? [];
  const ownWords = [...result.findings.present, ...exposures].filter((f) => f.said);
  const usedRecords = recordsShown(result);
  const missingSafety = result.triage?.missingSafety ?? [];
  return (
    <div className="flex flex-col gap-4">
      {review && <ClinicianReview review={review} />}
      {parent && (
        <p className="flex items-start gap-2 rounded-card bg-subtle px-3 py-2 text-secondary">
          <History aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-teal" />
          <span>
            Follow-up to your check on {formatDate(parent.createdAt)}
            {parent.title ? ` (${parent.title})` : ""}
            {parent.urgencyTitle ? `. Then, Nora advised: ${parent.urgencyTitle.toLowerCase()}.` : "."}
          </span>
        </p>
      )}
      {result.episode && (
        <p className="flex items-start gap-2 rounded-card bg-subtle px-3 py-2 text-secondary">
          <History aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-teal" />
          <span>
            {result.episode.label}{" "}
            {result.episode.earlier.checkId && (
              <a href={`/summary/${result.episode.earlier.checkId}`} className="font-medium text-brand-teal underline-offset-2 hover:underline">
                See the earlier check’s summary
              </a>
            )}
          </span>
        </p>
      )}
      <p className="text-meta text-fg-muted">Assessed {formatDate(result.createdAt, true)} IST</p>
      <section aria-label="Urgency" className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-meta font-medium text-fg-muted">
          <ShieldCheck aria-hidden className="size-4 text-brand-teal" />
          Decided by Nora’s clinical rules
        </p>
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
          {missingSafety.length > 0 && (
            <p className="mt-2 text-secondary">
              <span className="font-medium">Warning signs Nora couldn’t rule out:</span>{" "}
              {missingSafety.map((m) => `${m.label.toLowerCase()} (${SAFETY_GAP[m.gap]})`).join("; ")}. Nora doesn’t assume these are absent.
            </p>
          )}
        </Alert>
      </section>

      <section aria-labelledby="summary-h" className="flex flex-col gap-1">
        <h3 id="summary-h" className="text-card-title font-semibold">
          Summary
        </h3>
        <p className="flex items-center gap-1.5 text-meta font-medium text-fg-muted">
          <Sparkles aria-hidden className="size-4 text-brand-teal" />
          {EXPLAINED_BY[result.generator]}
        </p>
        <p className="text-body">{result.summary}</p>
      </section>

      {information.length > 0 && (
        <section aria-labelledby="info-h" className="flex flex-col gap-2">
          <h3 id="info-h" className="flex items-center gap-1.5 text-card-title font-semibold">
            <BookOpen aria-hidden className="size-4 text-brand-teal" />
            General health information
          </h3>
          <p className="text-meta text-fg-muted">General facts from approved sources about this kind of symptom. They are not about your case and are not a diagnosis.</p>
          {information.map((i) => (
            <Card key={i.code} className="flex flex-col gap-1.5">
              <p className="font-semibold">{i.title}</p>
              <p className="text-secondary">
                {i.text} <Citations ids={i.citations} />
              </p>
              {i.caution && (
                <p className="flex items-start gap-1.5 text-secondary font-medium text-warning">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {i.caution}
                </p>
              )}
            </Card>
          ))}
        </section>
      )}
      {(result.explanations?.length ?? 0) > 0 && (
        <p className="rounded-card bg-subtle px-3 py-2 text-secondary text-fg-muted">
          This check was made by an earlier version of Nora that suggested possible causes. They are no longer shown because Nora does not diagnose. Your urgency advice above is unchanged.
        </p>
      )}

      <section aria-labelledby="told-h" className="flex flex-col gap-2">
        <h3 id="told-h" className="text-card-title font-semibold">
          What you told Nora
        </h3>
        <FactChips label="You have" items={result.findings.present} tone="present" />
        <FactChips label="You don’t have" items={result.findings.absent} tone="absent" />
        <FactChips label="Not sure or skipped" items={result.findings.unknown} tone="unknown" />
        <FactChips label="Exposures you mentioned (not symptoms)" items={exposures} tone="present" />
        {ownWords.length > 0 && (
          <details className="text-secondary">
            <summary className="cursor-pointer text-meta font-medium text-fg-muted">What Nora read from your messages</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {ownWords.map((f) => (
                <li key={f.key}>
                  <span className="font-medium">{f.label}</span> <span className="text-fg-muted">from “{f.said}”</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {result.answerConflicts?.map((c) => (
          <p key={c.key} className="flex items-start gap-2 rounded-card bg-warning-bg px-3 py-2 text-secondary">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {c.answeredIn === "profile" ? (
              <span>
                Your health profile {c.answered === "yes" ? "lists" : "doesn’t list"} {c.label.toLowerCase()}, but your message{" "}
                {c.mentioned === "yes" ? "mentioned it" : "suggested you don’t have it"}.{" "}
                {c.resolution === "treated_as_present" ? "Nora used what you said for this check." : c.resolution === "ask_again" ? "Nora asked you about it to be sure." : "To be safe, Nora kept what your profile says."}{" "}
                <a href="/settings" className="font-medium text-brand-teal underline-offset-2 hover:underline">
                  Update your profile
                </a>
              </span>
            ) : (
              <span>
                You answered “{c.answered === "yes" ? "Yes" : "No"}” to {c.label.toLowerCase()}, but a later message {c.mentioned === "yes" ? "mentioned it" : "suggested you don’t have it"}.{" "}
                {CONFLICT_OUTCOME[c.resolution]}
              </span>
            )}
          </p>
        ))}
      </section>

      {result.findings.history && (result.findings.history.present.length > 0 || result.findings.history.absent.length > 0) && (
        <section aria-labelledby="background-h" className="flex flex-col gap-2">
          <h3 id="background-h" className="text-card-title font-semibold">
            Your health background
          </h3>
          <p className="text-meta text-fg-muted">Long-term conditions and medicines that affect this advice. They’re kept separate from today’s symptoms.</p>
          <FactChips label="You have" items={result.findings.history.present} tone="present" />
          <FactChips label="You don’t have" items={result.findings.history.absent} tone="absent" />
        </section>
      )}

      {usedRecords.length > 0 && (
        <section aria-labelledby="records-h" className="flex flex-col gap-2">
          <h3 id="records-h" className="text-card-title font-semibold">
            From your records
          </h3>
          <p className="text-meta text-fg-muted">Nora used only these confirmed records for this check.</p>
          <ul className="flex flex-col gap-1 text-secondary">
            {usedRecords.map((m) => (
              <li key={m.id}>
                <span className="text-fg-muted">{m.label}:</span> {m.text}
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-meta font-medium text-brand-teal underline-offset-2 hover:underline">
                      Read the original guidance
                    </a>
                  )}
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
            {findingText(f)}
          </li>
        ))}
      </ul>
    </div>
  );
}
