"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClipboardList, FileSearch, Loader2, Phone, Plus, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Alert, Button, cn, NoraMark, Panel } from "@nora/ui";
import { type EmergencyContacts, TERMINAL } from "@/lib/checks";
import type { CheckController } from "@/lib/use-check";
import { QuestionInput } from "./question-input";

const MAX_CHARS = 2000;

export function IntakePanel({
  controller,
  emergency: contacts,
  className,
  onShowFindings,
}: {
  controller: CheckController;
  emergency: EmergencyContacts;
  className?: string;
  onShowFindings(): void;
}) {
  const { check, stage, error, busy, consent, followUp } = controller;
  const assessing = check?.status === "ASSESSING" || (busy && !consent);
  const finished = check ? TERMINAL.includes(check.status) : false;
  const end = useRef<HTMLDivElement>(null);
  const messageCount = check?.messages.length ?? 0;
  const asking = check?.status === "COLLECTING" ? check.pendingQuestion : null;
  const emergency = check?.urgency === "emergency";
  const messages = check?.messages.filter((m) => !(asking && m.kind === "question" && m.questionId === asking.id)) ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messageCount, assessing, check?.pendingQuestion?.id]);

  return (
    <Panel title="Intake" titleId="intake-title" className={className}>
      <div className="flex min-h-full flex-col gap-3">
        {!check && !consent && (
          <>
            {followUp ? (
              <EmptyState
                icon={<RefreshCw aria-hidden className="size-6" />}
                title={`Follow-up: ${followUp.title ?? "earlier check"}`}
                body="Tell Nora how things are now: what has changed, what is better or worse, and anything new."
              />
            ) : (
              <EmptyState
                icon={<ClipboardList aria-hidden className="size-6" />}
                title="Start a check"
                body='Describe your main symptom in your own words, for example: "Sore throat and fever since yesterday."'
              />
            )}
            <p className="flex items-start gap-2 text-meta text-fg-muted">
              <Phone aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
              <span>
                Severe chest pain, trouble breathing or signs of a stroke? Call{" "}
                <a href={`tel:${contacts.number}`} className="font-semibold text-danger underline-offset-2 hover:underline">
                  {contacts.number}
                </a>{" "}
                now, don’t wait for Nora.
                {contacts.crisisLine && (
                  <>
                    {" "}
                    If you are thinking about harming yourself, call {contacts.crisisLine.name} on{" "}
                    <a href={`tel:${contacts.crisisLine.number}`} className="font-semibold underline-offset-2 hover:underline">
                      {contacts.crisisLine.number}
                    </a>
                    .
                  </>
                )}
              </span>
            </p>
          </>
        )}

        {check && (
          <ol aria-label="Conversation" className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className={cn("flex gap-2", m.sender === "patient" ? "justify-end" : "justify-start")}>
                {m.sender === "nora" && <NoraMark className="mt-1 size-6 shrink-0" />}
                <div
                  className={cn(
                    "max-w-[85%] rounded-card px-3 py-2 text-body",
                    m.sender === "patient"
                      ? "bg-brand-navy text-fg-inverse"
                      : m.kind === "error" || (m.kind === "result" && emergency)
                        ? "bg-danger-bg text-danger"
                        : m.kind === "review"
                          ? "border border-info/30 bg-info-bg"
                          : m.kind === "notice"
                            ? "border border-warning/30 bg-warning-bg"
                            : "bg-subtle",
                  )}
                >
                  {m.kind === "review" && (
                    <p className="text-meta font-semibold text-info">{check.review?.clinician ? `Note from ${check.review.clinician}` : "Note from your clinician"}</p>
                  )}
                  {m.kind === "result" ? (
                    <>
                      <p className="font-semibold">
                        {emergency
                          ? `This needs emergency care. Call ${check.emergency.number} now.`
                          : check.result?.status === "UNSUPPORTED"
                            ? "Nora can’t assess this symptom yet."
                            : "Your assessment is ready."}
                      </p>
                      <button type="button" onClick={onShowFindings} className="mt-1 inline-flex items-center gap-1 text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
                        <FileSearch aria-hidden className="size-4" />
                        {check.result?.status === "UNSUPPORTED" ? "See what to do next" : "View findings and next steps"}
                      </button>
                    </>
                  ) : (
                    m.text
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {assessing && (
          <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-card bg-subtle px-3 py-2 text-secondary text-fg-muted">
            <Loader2 aria-hidden className="size-4 animate-spin text-brand-teal" />
            {stage ?? "Working…"}
          </p>
        )}

        {consent && (
          <div className="flex flex-col gap-3 rounded-card border border-line p-4">
            <p className="flex items-center gap-2 text-card-title font-semibold">
              <ShieldCheck aria-hidden className="size-5 text-brand-teal" />
              {consent.title}
            </p>
            <p className="text-secondary text-fg-muted">{consent.body}</p>
            <p className="text-meta text-fg-muted">Notice version {consent.version}. You can withdraw this at any time from Privacy controls.</p>
            <p className="text-secondary">Nora will send your message once you agree. Nothing has been shared yet.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void controller.acceptConsent()} loading={busy}>
                I agree and want to continue
              </Button>
              <Button variant="ghost" disabled={busy} onClick={controller.reset}>
                Not now
              </Button>
            </div>
          </div>
        )}

        {error && (
          <Alert status="danger" title="That didn’t go through">
            {error}
          </Alert>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-2">
          {asking && <QuestionInput question={asking} busy={busy} onAnswer={(value) => void controller.answer(value)} />}
          {asking && !finished && <OwnWords key={asking.id} disabled={busy} onSubmit={(text) => controller.send(text)} />}
          {finished ? (
            <div className="flex flex-col gap-2 rounded-card border border-dashed border-line p-4">
              <p className="text-secondary text-fg-muted">This check is finished. To describe something new, start another check.</p>
              <Button variant="secondary" onClick={controller.reset} className="self-start">
                <Plus aria-hidden className="size-4" />
                New check
              </Button>
            </div>
          ) : (
            !consent && !check?.pendingQuestion && <Composer disabled={assessing} isFirst={!check} onSubmit={(text) => (check ? controller.send(text) : controller.start(text))} />
          )}
          <div ref={end} />
        </div>
      </div>
    </Panel>
  );
}

function OwnWords({ disabled, onSubmit }: { disabled: boolean; onSubmit(text: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="self-start text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
        Or describe it in your own words
      </button>
    );
  }
  return (
    <Composer
      disabled={disabled}
      label="Tell Nora in your own words"
      hint="Nora reads what you write, won’t ask again about anything you’ve already covered, and still checks warning signs."
      onSubmit={onSubmit}
    />
  );
}

function Composer({
  disabled,
  isFirst = false,
  label,
  hint,
  onSubmit,
}: {
  disabled: boolean;
  isFirst?: boolean;
  label?: string;
  hint?: string;
  onSubmit(text: string): Promise<void>;
}) {
  const [text, setText] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    await onSubmit(value);
    setText("");
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
      <label htmlFor="symptom" className="text-secondary font-medium">
        {label ?? (isFirst ? "What would you like help with?" : "Anything else you want to add?")}
      </label>
      {hint && <p className="text-meta text-fg-muted">{hint}</p>}
      <textarea
        id="symptom"
        rows={3}
        maxLength={MAX_CHARS}
        disabled={disabled}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event);
        }}
        placeholder="For example: sore throat and fever since yesterday"
        className="resize-none rounded-control border border-line-strong bg-panel p-3 text-body placeholder:text-fg-muted disabled:bg-subtle"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta text-fg-muted">
          {text.length}/{MAX_CHARS}
        </span>
        <Button type="submit" disabled={disabled || !text.trim()}>
          <Send aria-hidden className="size-4" />
          Continue
        </Button>
      </div>
    </form>
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-4">
      <span className="grid size-10 place-items-center rounded-control bg-subtle text-brand-teal">{icon}</span>
      <p className="text-card-title font-semibold">{title}</p>
      <p className="text-secondary text-fg-muted">{body}</p>
    </div>
  );
}
