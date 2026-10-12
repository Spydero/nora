"use client";

import { useState, type FormEvent } from "react";
import { History, Info } from "lucide-react";
import { Button, cn } from "@nora/ui";
import { formatDate } from "@/lib/care";
import type { AnswerValue, QuestionView } from "@/lib/checks";

export function QuestionInput({ question, busy, onAnswer }: { question: QuestionView; busy: boolean; onAnswer(value: AnswerValue): void }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-brand-teal/40 bg-panel p-4">
      {question.reason && (
        <p className="self-start rounded-control bg-info-bg px-2 py-0.5 text-meta font-medium text-info">
          <span className="sr-only">Why Nora is asking: </span>
          {question.reason}
        </p>
      )}
      <p id={`q-${question.id}`} className="text-card-title font-semibold">
        {question.text}
      </p>
      {question.earlierCheck && (
        <p className="flex gap-2 rounded-control bg-subtle px-3 py-2 text-secondary">
          <History aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-teal" />
          <span>
            Earlier check on {formatDate(question.earlierCheck.createdAt)}
            {question.earlierCheck.title ? `: ${question.earlierCheck.title}` : ""}
            {question.earlierCheck.advice ? `. Nora advised: ${question.earlierCheck.advice.toLowerCase()}.` : "."}
          </span>
        </p>
      )}
      {question.why && (
        <p className="flex gap-2 text-secondary text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {question.why}
        </p>
      )}
      {question.type === "yes_no" && <YesNo busy={busy} onAnswer={onAnswer} />}
      {question.type === "number" && <NumberAnswer key={question.id} question={question} busy={busy} onAnswer={onAnswer} />}
      {question.type === "multi" && <MultiAnswer key={question.id} question={question} busy={busy} onAnswer={onAnswer} />}
      {question.type === "text" && <TextAnswer key={question.id} question={question} busy={busy} onAnswer={onAnswer} />}
      {question.allowSkip && (
        <button type="button" disabled={busy} onClick={() => onAnswer(null)} className="self-start text-secondary text-fg-muted underline-offset-2 hover:underline">
          {question.type === "text" ? "No, nothing else" : "Skip this question"}
        </button>
      )}
      {question.stillToCover && question.type !== "text" && (
        <p className="border-t border-line pt-2 text-meta text-fg-muted">
          {question.stillToCover.length > 0
            ? `Still to check: ${question.stillToCover.join(" · ")}. Nora asks only what your answers make relevant, so this can change.`
            : "This is the last thing Nora needs to check, unless your answer raises something new."}
        </p>
      )}
    </div>
  );
}

function YesNo({ busy, onAnswer }: { busy: boolean; onAnswer(value: AnswerValue): void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => onAnswer("yes")}>
        Yes
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => onAnswer("no")}>
        No
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => onAnswer("unsure")}>
        Not sure
      </Button>
    </div>
  );
}

function NumberAnswer({ question, busy, onAnswer }: { question: QuestionView; busy: boolean; onAnswer(value: AnswerValue): void }) {
  const [raw, setRaw] = useState("");
  const value = Number(raw);
  const outOfRange = raw !== "" && ((question.min !== null && value < question.min) || (question.max !== null && value > question.max));
  const invalid = raw === "" || Number.isNaN(value) || outOfRange;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invalid) onAnswer(value);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          aria-labelledby={`q-${question.id}`}
          aria-invalid={outOfRange || undefined}
          min={question.min ?? undefined}
          max={question.max ?? undefined}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          className="min-h-11 w-32 rounded-control border border-line-strong bg-panel px-3 text-body"
        />
        {question.unit && <span className="text-secondary text-fg-muted">{question.unit}</span>}
        <Button type="submit" disabled={busy || invalid} className="ml-auto">
          Continue
        </Button>
      </div>
      {outOfRange && (
        <p role="alert" className="text-secondary text-danger">
          Enter a number between {question.min} and {question.max}.
        </p>
      )}
    </form>
  );
}

const MAX_TEXT = 2000;

function TextAnswer({ question, busy, onAnswer }: { question: QuestionView; busy: boolean; onAnswer(value: AnswerValue): void }) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed) onAnswer(trimmed);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        aria-labelledby={`q-${question.id}`}
        value={text}
        maxLength={MAX_TEXT}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        placeholder="For example: other symptoms, recent travel, medicines you’ve tried, or anything worrying you"
        className="min-h-20 w-full rounded-control border border-line-strong bg-panel px-3 py-2 text-body"
      />
      <Button type="submit" disabled={busy || !trimmed} className="self-end">
        Send
      </Button>
    </form>
  );
}

function MultiAnswer({ question, busy, onAnswer }: { question: QuestionView; busy: boolean; onAnswer(value: AnswerValue): void }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(value: string, exclusive: boolean) {
    setSelected((current) => {
      if (current.includes(value)) return current.filter((v) => v !== value);
      if (exclusive) return [value];
      const exclusiveValues = question.options.filter((o) => o.exclusive).map((o) => o.value);
      return [...current.filter((v) => !exclusiveValues.includes(v)), value];
    });
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-labelledby={`q-${question.id}`}>
      {question.options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 text-body",
              checked ? "border-brand-teal bg-subtle" : "border-line",
              option.exclusive && "mt-1",
            )}
          >
            <input type="checkbox" checked={checked} disabled={busy} onChange={() => toggle(option.value, option.exclusive)} className="size-4 shrink-0 accent-brand-teal" />
            {option.label}
          </label>
        );
      })}
      <Button disabled={busy || selected.length === 0} onClick={() => onAnswer(selected)} className="self-end">
        Continue
      </Button>
    </fieldset>
  );
}
