"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BadgeCheck, CalendarClock, ExternalLink, Languages, MapPin, Phone, Search, Stethoscope, Video } from "lucide-react";
import { Alert, Button, Card, StatusBadge } from "@nora/ui";
import { Empty, Loading, LoadError, PageShell, selectClass } from "@/components/page";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { careApi, clinicAddress, formatDate, formatFee, relativeTime, type Provider, type ProviderQuery } from "@/lib/care";
import { checksApi } from "@/lib/checks";
import { useLoad } from "@/lib/use-load";

export default function DoctorsPage() {
  return (
    <Suspense fallback={<PageShell title="Doctors"><Loading /></PageShell>}>
      <Doctors />
    </Suspense>
  );
}

function Doctors() {
  const params = useSearchParams();
  const checkId = params.get("check") ?? undefined;
  const { state } = useAuth();
  const isPatient = state.profile?.roles.includes("PATIENT") ?? false;
  const [filters, setFilters] = useState<ProviderQuery>({ specialty: params.get("specialty") ?? undefined, city: params.get("city") ?? undefined });
  const [text, setText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === (text.trim() || undefined) ? f : { ...f, q: text.trim() || undefined })), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const facets = useLoad(careApi.providerFacets);
  const providers = useLoad(() => careApi.providers(filters), JSON.stringify(filters));
  const check = useLoad(() => (checkId && isPatient ? checksApi.get(checkId) : Promise.resolve(null)), `${checkId}:${isPatient}`);
  const handoff = check.data?.result?.handoff;

  const set = (patch: Partial<ProviderQuery>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = !!(filters.specialty || filters.city || filters.mode || filters.language || filters.q);

  return (
    <PageShell
      title="Doctors"
      width="wide"
      description="Verified doctors and clinics in your organisation’s network. Booking happens with the clinic directly; Nora keeps a note so you can track it."
    >
      {check.data?.result && (
        <Alert status={check.data.urgency === "emergency" || check.data.urgency === "urgent" ? "warning" : "info"} title={`For your check: ${check.data.title ?? "recent check"}`}>
          {check.data.urgency === "emergency" ? (
            <p>
              This check needs emergency care. Call {check.data.emergency.number} now instead of booking an appointment.
            </p>
          ) : (
            <p>
              Nora suggested seeing {handoff?.specialty ? `a ${handoff.specialty.toLowerCase()}` : "a doctor"} {handoff?.timeframe ? `(${handoff.timeframe.toLowerCase()})` : ""}. Doctors
              below are filtered to match; booking from here links the visit to this check.
            </p>
          )}
        </Alert>
      )}

      <div className="grid gap-2 rounded-card border border-line bg-panel p-3 sm:grid-cols-2 lg:grid-cols-[2fr_repeat(4,1fr)]">
        <label className="relative block">
          <span className="sr-only">Search doctors or clinics</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search doctor or clinic"
            className="min-h-11 w-full rounded-control border border-line-strong bg-panel pl-10 pr-3 text-body placeholder:text-fg-muted"
          />
        </label>
        <FacetSelect label="Specialty" value={filters.specialty} options={facets.data?.specialties} onChange={(specialty) => set({ specialty })} />
        <FacetSelect label="City" value={filters.city} options={facets.data?.cities} onChange={(city) => set({ city })} />
        <FacetSelect label="Language" value={filters.language} options={facets.data?.languages} onChange={(language) => set({ language })} />
        <label className="flex flex-col">
          <span className="sr-only">Consultation type</span>
          <select className={selectClass} value={filters.mode ?? ""} onChange={(e) => set({ mode: (e.target.value || undefined) as ProviderQuery["mode"] })}>
            <option value="">In person or video</option>
            <option value="in_person">In person</option>
            <option value="video">Video</option>
          </select>
        </label>
      </div>

      {providers.error ? (
        <LoadError error={providers.error} onRetry={providers.reload} />
      ) : !providers.data ? (
        <Loading />
      ) : providers.data.length === 0 ? (
        <Empty icon={<Stethoscope aria-hidden className="size-6" />} title="No doctors match these filters">
          <Button variant="secondary" className="mt-2" onClick={() => { setText(""); setFilters({}); }}>
            Clear filters
          </Button>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-secondary text-fg-muted">
              {providers.data.length} verified {providers.data.length === 1 ? "doctor" : "doctors"}
            </p>
            {filtered && (
              <button type="button" className="text-secondary font-medium text-brand-teal underline-offset-2 hover:underline" onClick={() => { setText(""); setFilters({}); }}>
                Clear filters
              </button>
            )}
          </div>
          <ul className="grid gap-3 lg:grid-cols-2" aria-busy={providers.loading || undefined}>
            {providers.data.map((p) => (
              <li key={p.id}>
                <ProviderCard provider={p} checkId={check.data?.result && check.data.urgency !== "emergency" ? checkId : undefined} canBook={isPatient} />
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

function FacetSelect({ label, value, options, onChange }: { label: string; value?: string; options?: string[]; onChange(value: string | undefined): void }) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Any {label.toLowerCase()}</option>
        {value && !options?.includes(value) && <option value={value}>{value}</option>}
        {options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProviderCard({ provider: p, checkId, canBook }: { provider: Provider; checkId?: string; canBook: boolean }) {
  const [handoff, setHandoff] = useState<{ id: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const nextOpening = p.nextAvailableAt && new Date(p.nextAvailableAt).getTime() > now ? p.nextAvailableAt : null;
  const bookingHref = p.booking.method === "url" && p.booking.url ? p.booking.url : p.booking.phone ? `tel:${p.booking.phone.replace(/\s/g, "")}` : null;

  function recordHandoff() {
    setFailure(null);
    careApi
      .refer(p.id, checkId)
      .then((r) => setHandoff({ id: r.id }))
      .catch((err: unknown) => setFailure(err instanceof ApiError ? err.message : "Nora could not save this booking note."));
  }

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-card-title font-semibold">{p.name}</p>
          <p className="text-secondary text-fg-muted">
            {p.specialties.join(", ")} · {p.qualifications.join(", ")}
          </p>
        </div>
        {p.acceptingNewPatients ? <StatusBadge status="success">Taking new patients</StatusBadge> : <StatusBadge status="info">Existing patients</StatusBadge>}
      </div>

      <div className="grid gap-1.5 text-secondary sm:grid-cols-2">
        <div className="flex gap-2">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <p>
            <span className="font-medium">{p.clinic.name}</span>
            <br />
            <span className="text-fg-muted">{clinicAddress(p.clinic)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <p>
            {nextOpening ? (
              <>
                Next opening <span className="font-medium">{formatDate(nextOpening, true)}</span>
              </>
            ) : (
              "Ask the clinic for the next opening"
            )}
            {p.scheduleUpdatedAt && <span className="block text-meta text-fg-muted">Schedule shared by the clinic {relativeTime(p.scheduleUpdatedAt)}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Languages aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <p>{p.languages.join(", ")}</p>
        </div>
        <div className="flex gap-2">
          {p.consultationModes.includes("video") ? (
            <Video aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          ) : (
            <Stethoscope aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          )}
          <p>
            {p.consultationModes.map((m) => (m === "video" ? "Video" : "In person")).join(" or ")} · {p.fee.amount > 0 ? `${formatFee(p.fee.amount, p.fee.currency)} consultation` : "ask the clinic about fees"}
          </p>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-meta text-fg-muted">
        <BadgeCheck aria-hidden className="size-4 text-brand-teal" />
        Registration {p.registrationNumber}
        {p.verifiedAt ? ` · verified ${formatDate(p.verifiedAt)}` : ""}
      </p>

      {failure && <Alert status="danger" title="Not saved">{failure}</Alert>}
      {handoff ? (
        <Alert status="success" title="Booking opened">
          Once the clinic gives you a time,{" "}
          <Link href={`/appointments?add=${handoff.id}`} className="font-medium underline">
            add it to your appointments
          </Link>{" "}
          so Nora can remind you what to bring.
        </Alert>
      ) : canBook && !p.booking.available ? (
        <p className="mt-auto text-secondary text-fg-muted">
          Booking through Nora is paused right now.{p.clinic.phone ? ` You can call the clinic on ${p.clinic.phone}.` : ""}
        </p>
      ) : (
        canBook &&
        bookingHref && (
          <div className="mt-auto flex flex-wrap gap-2">
            <a
              href={bookingHref}
              target={p.booking.method === "url" ? "_blank" : undefined}
              rel="noopener noreferrer"
              onClick={recordHandoff}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-teal px-4 text-body font-medium text-fg-inverse hover:bg-brand-teal-hover"
            >
              {p.booking.method === "url" ? <ExternalLink aria-hidden className="size-4" /> : <Phone aria-hidden className="size-4" />}
              {p.booking.method === "url" ? "Book on clinic website" : `Call ${p.booking.phone}`}
            </a>
          </div>
        )
      )}
    </Card>
  );
}
