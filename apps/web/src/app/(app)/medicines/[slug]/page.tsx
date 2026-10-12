"use client";

import Link from "next/link";
import { use } from "react";
import { AlertTriangle, ArrowLeft, MessageCircleQuestion, Pill } from "lucide-react";
import { Alert, Card } from "@nora/ui";
import { Loading, LoadError, PageShell } from "@/components/page";
import { careApi, formatDate } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

export default function MedicinePage({ params }: PageProps<"/medicines/[slug]">) {
  const { slug } = use(params);
  const { data, error, reload } = useLoad(() => careApi.medicine(slug), slug);

  const back = (
    <Link href="/medicines" className="inline-flex items-center gap-1 text-secondary font-medium text-brand-teal underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden className="size-4" /> All medicines
    </Link>
  );

  if (!data) {
    return (
      <PageShell title="Medicine" width="narrow" actions={back}>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading />}
      </PageShell>
    );
  }

  return (
    <PageShell
      title={<span className="capitalize">{data.genericName}</span>}
      width="narrow"
      actions={back}
      description={`${data.category} · ${data.otc ? "Available over the counter" : "Prescription only"}`}
    >
      <Card className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-panel-title font-semibold">
          <Pill aria-hidden className="size-5 text-brand-teal" /> What it is for
        </h2>
        <p className="text-body">{data.purpose}</p>
        {data.brandExamples.length > 0 && (
          <p className="text-secondary text-fg-muted">
            Sold under brand names such as <span className="text-fg">{data.brandExamples.join(", ")}</span>. Check the generic name on the box — the same medicine can
            have many brand names.
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-panel-title font-semibold">Common side effects</h2>
        <ul className="list-disc pl-5 text-body">
          {data.commonSideEffects.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>

      {data.warnings.length > 0 && (
        <Alert status="warning" title="Important warnings">
          <ul className="list-disc pl-5">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="flex flex-col gap-2 border-brand-teal">
        <h2 className="flex items-center gap-2 text-panel-title font-semibold">
          <MessageCircleQuestion aria-hidden className="size-5 text-brand-teal" /> Talk to a doctor or pharmacist if
        </h2>
        <ul className="list-disc pl-5 text-body">
          {data.askClinicianIf.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Card>

      <p className="flex items-start gap-2 border-t border-line pt-3 text-meta text-fg-muted">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        General information reviewed by Nora’s clinical team on {formatDate(data.reviewedAt)}. It does not cover every use, side effect or interaction, and it is not a
        recommendation to take this medicine. Doses depend on you — follow your prescription or the pack leaflet.
      </p>
    </PageShell>
  );
}
