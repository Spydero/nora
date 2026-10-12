"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Download, Info, Printer, RotateCcw } from "lucide-react";
import { Alert, Button, Card, cn } from "@nora/ui";
import { Loading, LoadError, PageShell, textareaClass } from "@/components/page";
import { checksApi, CURRENT_CHECK_KEY, type DoctorSummary } from "@/lib/checks";
import { useLoad } from "@/lib/use-load";

const storageKey = (id: string) => `nora.summary.${id}`;

function savedEdits(id: string): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(id)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const CHARS_PER_LINE = 70;

/** Tall enough to show the whole section without scrolling, counting wrapped lines. */
const rowsFor = (text: string) =>
  Math.min(24, Math.max(2, text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0) + 1));

function asText(summary: DoctorSummary, edits: Record<string, string>) {
  const body = summary.sections
    .map((s) => ({ heading: s.heading, text: (edits[s.id] ?? s.text).trim() }))
    .filter((s) => s.text)
    .map((s) => `${s.heading.toUpperCase()}\n${s.text}`)
    .join("\n\n");
  return `${summary.title}\n${"=".repeat(summary.title.length)}\n\n${body}\n`;
}

export default function DoctorSummaryPage({ params }: PageProps<"/summary/[id]">) {
  const { id } = use(params);
  const { data, error, reload } = useLoad(() => checksApi.doctorSummary(id), id);
  const [edits, setEdits] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : savedEdits(id)));

  const update = (next: Record<string, string>) => {
    setEdits(next);
    sessionStorage.setItem(storageKey(id), JSON.stringify(next));
  };

  const back = (
    <Link
      href="/"
      onClick={() => sessionStorage.setItem(CURRENT_CHECK_KEY, id)}
      className="inline-flex items-center gap-1 text-secondary font-medium text-brand-teal underline-offset-2 hover:underline print:hidden"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back to your check
    </Link>
  );

  if (!data) {
    return (
      <PageShell title="Summary for your doctor" width="narrow" actions={back}>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Preparing your summary…" />}
      </PageShell>
    );
  }

  const edited = data.sections.filter((s) => edits[s.id] !== undefined && edits[s.id] !== s.text).length;

  const download = () => {
    const url = URL.createObjectURL(new Blob([asText(data, edits)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `nora-consultation-summary-${data.generatedAt.slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell
      title="Summary for your doctor"
      width="narrow"
      actions={back}
      description={
        <span className="print:hidden">
          Check each section and correct anything that isn’t right before you share it. Your changes stay on this device until you close the tab.
        </span>
      }
    >
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={download}>
          <Download aria-hidden className="size-4" /> Download (.txt)
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" /> Print or save as PDF
        </Button>
        {edited > 0 && (
          <Button variant="secondary" onClick={() => update({})}>
            <RotateCcw aria-hidden className="size-4" /> Undo my changes
          </Button>
        )}
      </div>
      {edited > 0 && (
        <p className="text-meta text-fg-muted print:hidden">
          You’ve changed {edited} section{edited === 1 ? "" : "s"}. The summary says it may have been edited.
        </p>
      )}

      <Card className="flex flex-col gap-5 print:border-0 print:p-0 print:shadow-none">
        <h2 className="text-panel-title font-semibold">{data.title}</h2>
        {data.sections.map((s) => {
          const value = edits[s.id] ?? s.text;
          const changed = edits[s.id] !== undefined && edits[s.id] !== s.text;
          const fieldId = `summary-${s.id}`;
          if (s.id === "notes" && !value.trim()) {
            return (
              <div key={s.id} className="flex flex-col gap-1 print:hidden">
                <label htmlFor={fieldId} className="font-semibold">
                  {s.heading}
                </label>
                <textarea id={fieldId} className={textareaClass} rows={3} placeholder="For example, when it started, what you’ve tried, or what worries you most." value={value} onChange={(e) => update({ ...edits, [s.id]: e.target.value })} />
              </div>
            );
          }
          return (
            <div key={s.id} className="flex flex-col gap-1 break-inside-avoid">
              <div className="flex items-baseline gap-2">
                <label htmlFor={fieldId} className="font-semibold">
                  {s.heading}
                </label>
                {changed && <span className="text-meta font-medium text-brand-teal print:hidden">Edited</span>}
              </div>
              <textarea
                id={fieldId}
                className={cn(textareaClass, "font-[inherit] print:hidden", s.id === "disclaimer" && "text-secondary text-fg-muted")}
                rows={rowsFor(value)}
                value={value}
                onChange={(e) => update({ ...edits, [s.id]: e.target.value })}
              />
              <p className={cn("hidden whitespace-pre-wrap text-body print:block", s.id === "disclaimer" && "text-meta")}>{value}</p>
            </div>
          );
        })}
      </Card>

      <div className="print:hidden">
        <Alert status="info" title="Before you share it">
          <p className="flex items-start gap-2">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            Nora built this from what you told it in this check and the records in your profile. It isn’t a diagnosis. If your symptoms get worse, follow the
            advice in your check rather than waiting to share this.
          </p>
        </Alert>
      </div>
    </PageShell>
  );
}
