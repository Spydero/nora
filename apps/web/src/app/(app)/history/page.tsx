"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, History, Stethoscope } from "lucide-react";
import { Button, Card, StatusBadge } from "@nora/ui";
import { URGENCY_STATUS } from "@/components/check/findings-panel";
import { Empty, Loading, LoadError, PageShell } from "@/components/page";
import { careApi, formatDate, URGENCY_LABEL, type CheckSummary } from "@/lib/care";
import { CURRENT_CHECK_KEY } from "@/lib/checks";
import { useLoad } from "@/lib/use-load";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not started",
  COLLECTING: "In progress",
  AWAITING_CONFIRMATION: "In progress",
  ASSESSING: "Being assessed",
  COMPLETED: "Assessed",
  INCOMPLETE: "Incomplete",
  ESCALATED: "Urgent guidance given",
  ARCHIVED: "Archived",
};

export default function HistoryPage() {
  const router = useRouter();
  const { data, error, reload } = useLoad(careApi.checks);

  function open(check: CheckSummary) {
    sessionStorage.setItem(CURRENT_CHECK_KEY, check.id);
    router.push("/");
  }

  return (
    <PageShell
      title="History"
      width="narrow"
      description="Your past symptom checks. Open one to see the findings, next steps and any clinician review."
      actions={
        <Link
          href="/"
          onClick={() => sessionStorage.removeItem(CURRENT_CHECK_KEY)}
          className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline"
        >
          Start a new check
        </Link>
      }
    >
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty icon={<History aria-hidden className="size-6" />} title="No checks yet">
          When you describe a symptom, the check is saved here so you can come back to it.
        </Empty>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.title ?? "Untitled check"}</p>
                  <p className="text-meta text-fg-muted">
                    {formatDate(c.createdAt, true)} · {STATUS_LABEL[c.status] ?? c.status}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.urgency && <StatusBadge status={URGENCY_STATUS[c.urgency]}>{URGENCY_LABEL[c.urgency]}</StatusBadge>}
                    {c.reviewStatus === "REVIEWED" && (
                      <span className="inline-flex items-center gap-1 rounded-control bg-info-bg px-2 py-1 text-secondary font-medium text-info">
                        <Stethoscope aria-hidden className="size-4" /> Reviewed by a clinician
                      </span>
                    )}
                    {c.reviewStatus === "CORRECTED" && (
                      <span className="inline-flex items-center gap-1 rounded-control bg-warning-bg px-2 py-1 text-secondary font-medium text-warning">
                        <Stethoscope aria-hidden className="size-4" /> Updated by a clinician
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => open(c)} className="max-sm:w-full">
                  Open
                  <ChevronRight aria-hidden className="size-4" />
                </Button>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
