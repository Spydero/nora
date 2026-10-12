"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, StatusBadge } from "@nora/ui";
import { Loading, LoadError, PageShell, SectionTitle } from "@/components/page";
import { careApi, formatDate } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

export default function ContentPage() {
  const { data, error, reload } = useLoad(careApi.content);

  return (
    <PageShell
      title="Clinical content"
      width="wide"
      description="The approved rules, questions and sources Nora uses. Changes go through authoring, clinical approval and safety testing before release."
    >
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <section aria-labelledby="bundles-h" className="flex flex-col gap-3">
            <SectionTitle id="bundles-h">Clinical bundles</SectionTitle>
            <ul className="grid gap-2 lg:grid-cols-2">
              {data.bundles.map((b) => (
                <li key={b.id}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">Version {b.version}</p>
                      <div className="flex gap-2">
                        {b.active && <StatusBadge status="success">Live</StatusBadge>}
                        <StatusBadge status="info">{b.status.toLowerCase().replace("_", " ")}</StatusBadge>
                      </div>
                    </div>
                    {b.changeNote && <p className="text-secondary text-fg-muted">{b.changeNote}</p>}
                    <p className="text-secondary">
                      {b.concerns} symptom areas · {b.questions} questions · {b.rules} urgency rules
                    </p>
                    {b.evaluation && (
                      <p className="text-secondary">
                        Safety tests:{" "}
                        <span className={b.evaluation.passed ? "font-medium text-success" : "font-medium text-danger"}>
                          {b.evaluation.sentinelsPassed} of {b.evaluation.sentinelsTotal} sentinel cases passed
                        </span>
                      </p>
                    )}
                    <p className="text-meta text-fg-muted">
                      {b.approvedAt ? `Approved ${formatDate(b.approvedAt)}` : "Not approved"}
                      {b.releasedAt ? ` · released ${formatDate(b.releasedAt)}` : ""}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="sources-h" className="flex flex-col gap-3">
            <SectionTitle id="sources-h">Approved sources</SectionTitle>
            <div className="overflow-x-auto rounded-card border border-line bg-panel">
              <table className="w-full min-w-[760px] text-left text-secondary">
                <thead className="border-b border-line bg-subtle text-meta text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Covers</th>
                    <th className="px-4 py-2 font-medium">Passages</th>
                    <th className="px-4 py-2 font-medium">Next review</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.documents.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium">
                          {d.url ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                              {d.title} <ExternalLink aria-hidden className="size-3.5" />
                            </a>
                          ) : (
                            d.title
                          )}
                        </p>
                        <p className="text-meta text-fg-muted">{d.publisher}</p>
                      </td>
                      <td className="px-4 py-2 text-fg-muted">{d.concernCodes.length ? d.concernCodes.join(", ").replace(/_/g, " ") : "All checks (safety)"}</td>
                      <td className="px-4 py-2">{d.chunks}</td>
                      <td className={d.reviewOverdue ? "px-4 py-2 font-medium text-danger" : "px-4 py-2"}>
                        {formatDate(d.reviewDueAt)}
                        {d.reviewOverdue ? " (overdue)" : ""}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={d.status === "APPROVED" ? "success" : "warning"}>{d.status.toLowerCase()}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="meds-h" className="flex flex-col gap-3">
            <SectionTitle id="meds-h">Medicine library</SectionTitle>
            <p className="-mt-2 text-secondary text-fg-muted">{data.medicines.length} entries. Select one to see what patients read.</p>
            <ul className="flex flex-wrap gap-1.5">
              {data.medicines.map((m) => (
                <li key={m.slug}>
                  <Link href={`/medicines/${m.slug}`} className="inline-block rounded-control border border-line bg-panel px-2.5 py-1 text-secondary capitalize hover:border-brand-teal" title={`Reviewed ${formatDate(m.reviewedAt)}`}>
                    {m.genericName}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PageShell>
  );
}
