"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Pill, Search } from "lucide-react";
import { Alert, Card } from "@nora/ui";
import { Empty, Loading, LoadError, PageShell } from "@/components/page";
import { careApi } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

export default function MedicinesPage() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useLoad(() => careApi.medicines(query), query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <PageShell title="Medicines" description="Plain-language information about common medicines: what they are for, common side effects and when to talk to a doctor.">
      <Alert status="info" title="For learning, not prescribing">
        Nora does not recommend medicines or doses. Always follow the advice of your doctor or pharmacist and the leaflet that comes with your medicine.
      </Alert>

      <label className="relative block max-w-xl">
        <span className="sr-only">Search medicines</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, brand or what it treats"
          className="min-h-11 w-full rounded-control border border-line-strong bg-panel pl-10 pr-3 text-body placeholder:text-fg-muted"
        />
      </label>

      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty icon={<Pill aria-hidden className="size-6" />} title={`No medicines match “${query}”`}>
          Try the generic name (for example paracetamol) or a brand name printed on the box.
        </Empty>
      ) : (
        <div className="flex flex-col gap-3" aria-busy={loading || undefined}>
          <p role="status" className="text-meta text-fg-muted">
            {data.length} {data.length === 1 ? "medicine" : "medicines"}
            {query ? ` matching “${query}”` : ""}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((m) => (
              <li key={m.slug}>
                <Link href={`/medicines/${m.slug}`} className="group block h-full rounded-card focus-visible:outline-2">
                  <Card className="flex h-full flex-col gap-1.5 group-hover:border-brand-teal">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold capitalize">{m.genericName}</p>
                        <p className="text-meta text-fg-muted">{m.category}</p>
                      </div>
                      <span className="shrink-0 rounded-control bg-subtle px-2 py-0.5 text-meta font-medium text-fg-muted">
                        {m.otc ? "Over the counter" : "Prescription"}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-secondary">{m.purpose}</p>
                    {m.brandExamples.length > 0 && <p className="text-meta text-fg-muted">e.g. {m.brandExamples.slice(0, 3).join(", ")}</p>}
                    <span className="mt-auto inline-flex items-center gap-1 pt-1 text-secondary font-medium text-brand-teal">
                      Learn more <ChevronRight aria-hidden className="size-4" />
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
