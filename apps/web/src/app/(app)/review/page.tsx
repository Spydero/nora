"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, ClipboardCheck, Clock, UserRound } from "lucide-react";
import { Card, cn, StatusBadge } from "@nora/ui";
import { URGENCY_STATUS } from "@/components/check/findings-panel";
import { Empty, Loading, LoadError, PageShell } from "@/components/page";
import { careApi, formatDate, relativeTime, URGENCY_LABEL } from "@/lib/care";
import { reasonLabel } from "@/lib/review-labels";
import { useLoad } from "@/lib/use-load";

export default function ReviewQueuePage() {
  const [tab, setTab] = useState<"open" | "done">("open");
  const { data, error, loading, reload } = useLoad(() => careApi.reviewTasks(tab), tab);
  const overdue = tab === "open" ? (data?.filter((t) => t.overdue).length ?? 0) : 0;

  return (
    <PageShell
      title="Review queue"
      width="wide"
      description="Checks Nora flagged for a clinician: emergency and urgent results, and summaries the AI could not write safely. Only patients who agreed to share with clinicians appear here."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Queue" className="inline-grid grid-cols-2 gap-1 rounded-control bg-subtle p-1">
          {(["open", "done"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("min-h-10 rounded-control px-4 text-secondary font-medium", tab === t ? "bg-panel text-brand-navy shadow-sm" : "text-fg-muted")}
            >
              {t === "open" ? "To review" : "Completed"}
            </button>
          ))}
        </div>
        {data && !loading && (
          <p role="status" className="text-secondary text-fg-muted">
            {data.length} {tab === "open" ? "waiting" : "completed"}
            {overdue > 0 && <span className="font-semibold text-danger"> · {overdue} past due</span>}
          </p>
        )}
      </div>

      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data || loading ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty icon={<ClipboardCheck aria-hidden className="size-6" />} title={tab === "open" ? "Nothing waiting for review" : "No completed reviews yet"}>
          {tab === "open" ? "New flagged checks will appear here automatically." : "Cases you and your colleagues review are listed here."}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((t) => (
            <li key={t.id}>
              <Link href={`/review/${t.id}`} className="group block rounded-card">
                <Card className={cn("flex flex-wrap items-center gap-3 group-hover:border-brand-teal sm:flex-nowrap", t.overdue && "border-danger")}>
                  <div className="w-44 shrink-0">
                    {t.check.urgency ? <StatusBadge status={URGENCY_STATUS[t.check.urgency]}>{URGENCY_LABEL[t.check.urgency]}</StatusBadge> : <StatusBadge status="info">No urgency</StatusBadge>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.check.title ?? "Untitled check"}</p>
                    <p className="text-secondary text-fg-muted">
                      {t.patient.name ?? "Patient"}
                      {t.patient.age !== null ? `, ${t.patient.age}` : ""} · {t.reasons.map(reasonLabel).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-meta">
                    {tab === "open" ? (
                      <span className={cn("inline-flex items-center gap-1 font-medium", t.overdue ? "text-danger" : "text-fg-muted")}>
                        <Clock aria-hidden className="size-3.5" />
                        {t.overdue ? "Overdue · " : ""}due {relativeTime(t.dueAt)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">Flagged {formatDate(t.createdAt)}</span>
                    )}
                    <span className="inline-flex items-center gap-1 text-fg-muted">
                      <UserRound aria-hidden className="size-3.5" />
                      {t.assignee ? (t.assignee.isMe ? "You" : t.assignee.name) : "Unassigned"}
                    </span>
                  </div>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-fg-muted max-sm:hidden" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
