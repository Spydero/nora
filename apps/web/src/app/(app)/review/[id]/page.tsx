"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Quote, ShieldAlert } from "lucide-react";
import { Alert, Button, Card, cn, NoraMark, Panel, StatusBadge } from "@nora/ui";
import { ResultView, URGENCY_STATUS } from "@/components/check/findings-panel";
import { Loading, LoadError, PageShell, selectClass, textareaClass } from "@/components/page";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { careApi, formatDate, relativeTime, URGENCY_LABEL, type ReviewCase } from "@/lib/care";
import type { UrgencyLevel } from "@/lib/checks";
import { FACT_SOURCE, reasonLabel } from "@/lib/review-labels";
import { useLoad } from "@/lib/use-load";

const LEVELS: UrgencyLevel[] = ["emergency", "urgent", "soon", "routine", "self_care"];
const SEX: Record<string, string> = { FEMALE: "Female", MALE: "Male", INTERSEX: "Intersex", UNKNOWN: "Sex not recorded" };
const PREGNANCY: Record<string, string> = { PREGNANT: "Pregnant", NOT_PREGNANT: "Not pregnant", NOT_APPLICABLE: "", UNKNOWN: "Pregnancy unknown" };

export default function ReviewCasePage({ params }: PageProps<"/review/[id]">) {
  const { id } = use(params);
  const { state } = useAuth();
  const canDecide = state.profile?.roles.some((r) => r === "CLINICIAN" || r === "CLINICAL_APPROVER") ?? false;
  const { data, error, reload, setData } = useLoad(() => careApi.reviewCase(id), id);

  const back = (
    <Link href="/review" className="inline-flex items-center gap-1 text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> Review queue
    </Link>
  );

  if (!data) {
    return (
      <PageShell title="Case review" width="wide" actions={back}>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Opening case… (this access is recorded)" />}
      </PageShell>
    );
  }

  const p = data.patient;
  return (
    <PageShell
      title={data.check.title ?? "Untitled check"}
      width="wide"
      actions={back}
      description={
        <>
          {p.name}
          {p.age !== null ? `, ${p.age}` : ""} · {SEX[p.sexAtBirth]}
          {PREGNANCY[p.pregnancyStatus] ? ` · ${PREGNANCY[p.pregnancyStatus]}` : ""} · started {formatDate(data.check.createdAt, true)}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {data.check.urgency && <StatusBadge status={URGENCY_STATUS[data.check.urgency]}>{URGENCY_LABEL[data.check.urgency]}</StatusBadge>}
        {data.reasons.map((r) => (
          <span key={r} className="rounded-control bg-subtle px-2 py-1 text-secondary font-medium">
            {reasonLabel(r)}
          </span>
        ))}
        <span className="text-meta text-fg-muted">Opening this case was recorded in the audit log.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,30fr)_minmax(0,40fr)_minmax(0,30fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="Patient background" titleId="bg-h">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-secondary">
              <dt className="text-fg-muted">Conditions</dt>
              <dd>{p.conditions}</dd>
              <dt className="text-fg-muted">Medicines</dt>
              <dd>{p.medications}</dd>
              <dt className="text-fg-muted">Allergies</dt>
              <dd>{p.allergies}</dd>
            </dl>
          </Panel>
          <Panel title="Conversation" titleId="conv-h">
            <ol className="flex flex-col gap-2">
              {data.messages.map((m) => (
                <li key={m.id} className={cn("flex gap-2", m.sender === "patient" ? "justify-end" : "justify-start")}>
                  {m.sender === "nora" && <NoraMark className="mt-1 size-5 shrink-0" />}
                  <div className={cn("max-w-[85%] rounded-card px-3 py-2 text-secondary", m.sender === "patient" ? "bg-brand-navy text-fg-inverse" : "bg-subtle")}>
                    {m.kind === "result" ? <span className="italic">Result shown to patient</span> : m.text}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <Panel title="What Nora told the patient" titleId="result-h">
          <ResultView result={data.result} review={null} />
        </Panel>

        <div className="flex flex-col gap-4">
          <DecisionPanel review={data} canDecide={canDecide} onChange={setData} />
          <Panel title="Evidence trail" titleId="facts-h">
            <ul className="flex flex-col gap-2">
              {data.facts.map((f) => (
                <li key={f.key} className="text-secondary">
                  <p>
                    <span className={cn("font-medium", f.state === "ABSENT" && "text-fg-muted line-through decoration-1")}>{f.label}</span>
                    {f.value !== null ? `: ${f.value}${f.unit ? ` ${f.unit}` : ""}` : ""}{" "}
                    <span className="text-meta text-fg-muted">
                      · {f.state.toLowerCase().replace("_", " ")} · {FACT_SOURCE[f.source] ?? f.source}
                    </span>
                  </p>
                  {f.quote && (
                    <p className="mt-0.5 flex gap-1 text-meta text-fg-muted">
                      <Quote aria-hidden className="size-3 shrink-0" />“{f.quote}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {data.urgencyHistory.length > 0 && (
              <>
                <h3 className="mt-4 text-card-title font-semibold">Urgency decisions</h3>
                <ol className="mt-1 flex flex-col gap-1 text-secondary">
                  {data.urgencyHistory.map((u, i) => (
                    <li key={i}>
                      <span className="font-medium">{URGENCY_LABEL[u.level]}</span>{" "}
                      <span className="text-fg-muted">
                        · {u.source === "CLINICIAN" ? "clinician" : "safety rules"} {u.ruleIds.length > 0 && `(${u.ruleIds.join(", ")})`} · {formatDate(u.createdAt, true)}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

function DecisionPanel({ review, canDecide, onChange }: { review: ReviewCase; canDecide: boolean; onChange(next: ReviewCase): void }) {
  const [decision, setDecision] = useState<"AGREE" | "CHANGE_URGENCY">("AGREE");
  const [level, setLevel] = useState<UrgencyLevel | "">("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const open = review.status !== "DONE";
  const mine = review.assignee?.isMe ?? false;
  const field = (name: string) => failure?.fields.find((f) => f.field === name)?.message;

  async function run(label: string, action: () => Promise<ReviewCase>) {
    setBusy(label);
    setFailure(null);
    try {
      onChange(await action());
    } catch (err) {
      setFailure(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Something went wrong."));
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run("decide", () =>
      careApi.decide(review.id, {
        version: review.version,
        decision,
        correctedUrgency: decision === "CHANGE_URGENCY" && level ? level : undefined,
        reason,
        patientNote: note.trim() || undefined,
      }),
    );
  }

  return (
    <Panel title="Clinical decision" titleId="decision-h" actions={open ? <span className="text-meta text-fg-muted">Due {relativeTime(review.dueAt)}</span> : undefined}>
      <div className="flex flex-col gap-3">
        {failure && failure.fields.length === 0 && (
          <Alert status={failure.code === "REVIEW_CHANGED" ? "warning" : "danger"} title={failure.code === "REVIEW_CHANGED" ? "This case changed" : "Not saved"}>
            {failure.message}
          </Alert>
        )}

        {review.decisions.map((d) => (
          <Card key={d.id} className="flex flex-col gap-1 bg-subtle">
            <p className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 aria-hidden className="size-4 text-success" />
              {d.decision === "AGREE" ? "Agreed with Nora" : `Changed urgency to ${URGENCY_LABEL[d.correctedUrgency!]}`}
            </p>
            <p className="text-secondary">{d.reason}</p>
            {d.patientNote && <p className="text-secondary text-fg-muted">Note to patient: “{d.patientNote}”</p>}
            <p className="text-meta text-fg-muted">
              {d.clinician} · {formatDate(d.createdAt, true)}
            </p>
          </Card>
        ))}

        {open && (
          <p className="text-secondary">
            {review.assignee ? (mine ? "You are reviewing this case." : `${review.assignee.name} is reviewing this case.`) : "Nobody has picked this case up yet."}
          </p>
        )}

        {open && canDecide && !review.assignee && (
          <Button loading={busy === "claim"} onClick={() => run("claim", () => careApi.claim(review.id, review.version))}>
            Pick up this case
          </Button>
        )}

        {open && canDecide && mine && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-secondary font-medium">Nora’s urgency was {review.check.urgency ? URGENCY_LABEL[review.check.urgency].toLowerCase() : "not set"}</legend>
              {(["AGREE", "CHANGE_URGENCY"] as const).map((d) => (
                <label key={d} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3", decision === d ? "border-brand-teal bg-subtle" : "border-line")}>
                  <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-brand-teal" />
                  <span className="text-secondary font-medium">{d === "AGREE" ? "Agree with Nora’s advice" : "Change the urgency"}</span>
                </label>
              ))}
            </fieldset>
            {decision === "CHANGE_URGENCY" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-secondary font-medium">Corrected urgency</span>
                <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as UrgencyLevel)} aria-invalid={field("correctedUrgency") ? true : undefined}>
                  <option value="">Choose…</option>
                  {LEVELS.filter((l) => l !== review.check.urgency).map((l) => (
                    <option key={l} value={l}>
                      {URGENCY_LABEL[l]}
                    </option>
                  ))}
                </select>
                {field("correctedUrgency") && <span className="text-secondary text-danger">{field("correctedUrgency")}</span>}
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-secondary font-medium">Clinical reason (staff only)</span>
              <textarea className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-invalid={field("reason") ? true : undefined} />
              {field("reason") && <span className="text-secondary text-danger">{field("reason")}</span>}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-secondary font-medium">Message to the patient (optional)</span>
              <span className="text-meta text-fg-muted">Shown in their check. Write in plain language.</span>
              <textarea className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "decide"}>
                Sign off decision
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => run("release", () => careApi.release(review.id, review.version))}>
                Return to queue
              </Button>
            </div>
          </form>
        )}

        {open && !canDecide && (
          <p className="flex items-start gap-2 text-secondary text-fg-muted">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            Only clinicians can sign off a decision. You can follow up with the patient using your usual process.
          </p>
        )}
      </div>
    </Panel>
  );
}
