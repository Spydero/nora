"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { CalendarDays, CalendarPlus, Info, MapPin } from "lucide-react";
import { Alert, Button, Card, StatusBadge, TextField, type Status } from "@nora/ui";
import { Empty, Loading, LoadError, PageShell, SectionTitle, selectClass, textareaClass } from "@/components/page";
import { ApiError } from "@/lib/api";
import { careApi, clinicAddress, formatDate, type Appointment, type AppointmentStatus, type Provider, type Referral } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

const STATUS: Record<AppointmentStatus, { label: string; status: Status }> = {
  PATIENT_REPORTED: { label: "Booked", status: "info" },
  ATTENDED: { label: "Attended", status: "success" },
  MISSED: { label: "Missed", status: "warning" },
  CANCELLED: { label: "Cancelled", status: "danger" },
};

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<PageShell title="Appointments"><Loading /></PageShell>}>
      <Appointments />
    </Suspense>
  );
}

function Appointments() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, reload } = useLoad(careApi.appointments);
  const [adding, setAdding] = useState<{ referralId?: string } | null>(params.get("add") ? { referralId: params.get("add")! } : null);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  const pendingReferrals = data?.referrals.filter((r) => r.status === "HANDOFF_OPENED") ?? [];
  const upcoming = data?.appointments.filter((a) => a.status === "PATIENT_REPORTED" && new Date(a.scheduledAt).getTime() >= now) ?? [];
  const past = data?.appointments.filter((a) => !upcoming.includes(a)).reverse() ?? [];

  return (
    <PageShell
      title="Appointments"
      description="Keep track of visits you booked with clinics. Nora does not book for you, so these are the details you entered."
      actions={
        !adding && (
          <Button onClick={() => setAdding({})}>
            <CalendarPlus aria-hidden className="size-4" />
            Add appointment
          </Button>
        )
      }
    >
      {notice && <Alert status="success" title={notice} />}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {adding && (
            <AddAppointment
              referrals={data.referrals}
              referralId={adding.referralId}
              onCancel={() => setAdding(null)}
              onSaved={() => {
                setAdding(null);
                if (params.get("add")) router.replace("/appointments");
                setNotice("Appointment saved");
                reload();
              }}
            />
          )}

          {pendingReferrals.length > 0 && (
            <section aria-labelledby="handoff-h" className="flex flex-col gap-2">
              <SectionTitle id="handoff-h">Bookings you started</SectionTitle>
              <p className="text-secondary text-fg-muted">You opened these clinics’ booking pages from Nora. Did you get a time?</p>
              <ul className="grid gap-2 md:grid-cols-2">
                {pendingReferrals.map((r) => (
                  <li key={r.id}>
                    <Card className="flex h-full flex-col gap-2">
                      <p className="font-semibold">{r.provider?.name ?? "Doctor no longer listed"}</p>
                      <p className="text-secondary text-fg-muted">
                        {r.specialty ?? r.provider?.specialties[0]} · opened {formatDate(r.createdAt, true)}
                        {r.check?.title && (
                          <>
                            <br />
                            For: {r.check.title}
                          </>
                        )}
                      </p>
                      {r.provider && (
                        <div className="mt-auto">
                          <Button variant="secondary" onClick={() => { setNotice(null); setAdding({ referralId: r.id }); }}>
                            Add appointment time
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="upcoming-h" className="flex flex-col gap-2">
            <SectionTitle id="upcoming-h">Upcoming</SectionTitle>
            {upcoming.length === 0 ? (
              <Empty icon={<CalendarDays aria-hidden className="size-6" />} title="No upcoming appointments">
                <Link href="/doctors" className="font-medium text-brand-teal underline-offset-2 hover:underline">
                  Find a doctor
                </Link>{" "}
                or add a visit you booked elsewhere.
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <AppointmentCard appointment={a} upcoming onChanged={reload} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past-h" className="flex flex-col gap-2">
              <SectionTitle id="past-h">Past and cancelled</SectionTitle>
              <ul className="flex flex-col gap-2">
                {past.map((a) => (
                  <li key={a.id}>
                    <AppointmentCard appointment={a} onChanged={reload} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

function AppointmentCard({ appointment: a, upcoming = false, onChanged }: { appointment: Appointment; upcoming?: boolean; onChanged(): void }) {
  const [busy, setBusy] = useState<AppointmentStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reported = a.status === "PATIENT_REPORTED";

  async function set(status: AppointmentStatus) {
    setBusy(status);
    setFailure(null);
    try {
      await careApi.updateAppointment(a.id, { status });
      onChanged();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Could not update this appointment.");
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-card-title font-semibold">{formatDate(a.scheduledAt, true)}</p>
          <p className="text-secondary">
            {a.provider?.name ?? "Doctor"} {a.provider && <span className="text-fg-muted">· {a.provider.specialties.join(", ")}</span>}
          </p>
        </div>
        <StatusBadge status={STATUS[a.status].status}>{STATUS[a.status].label}</StatusBadge>
      </div>
      {a.provider && (
        <p className="flex items-start gap-1.5 text-secondary text-fg-muted">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          {a.provider.clinic.city === "Online" ? "Video consultation" : `${a.provider.clinic.name}, ${clinicAddress(a.provider.clinic)}`}
          {a.provider.clinic.phone ? ` · ${a.provider.clinic.phone}` : ""}
        </p>
      )}
      {a.notes && <p className="rounded-control bg-subtle px-3 py-2 text-secondary">{a.notes}</p>}
      <p className="flex items-center gap-1.5 text-meta text-fg-muted">
        <Info aria-hidden className="size-3.5" />
        Reported by you — not confirmed by the clinic.
      </p>
      {failure && <Alert status="danger" title="Not updated">{failure}</Alert>}
      {reported && (
        <div className="flex flex-wrap gap-2">
          {upcoming ? (
            <Button variant="secondary" loading={busy === "CANCELLED"} onClick={() => set("CANCELLED")}>
              I cancelled this
            </Button>
          ) : (
            <>
              <Button variant="secondary" loading={busy === "ATTENDED"} onClick={() => set("ATTENDED")}>
                I went
              </Button>
              <Button variant="ghost" loading={busy === "MISSED"} onClick={() => set("MISSED")}>
                I missed it
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function AddAppointment({ referrals, referralId, onCancel, onSaved }: { referrals: Referral[]; referralId?: string; onCancel(): void; onSaved(): void }) {
  const directory = useLoad(() => careApi.providers({}));
  const fromReferral = referrals.find((r) => r.id === referralId);
  const [providerId, setProviderId] = useState(fromReferral?.provider?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const options = new Map<string, Provider>();
  for (const r of referrals) if (r.provider) options.set(r.provider.id, r.provider);
  for (const p of directory.data ?? []) options.set(p.id, p);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!providerId || !date || !time) return;
    setBusy(true);
    setFailure(null);
    try {
      const linked = referrals.find((r) => r.provider?.id === providerId && r.status === "HANDOFF_OPENED" && (!referralId || r.id === referralId));
      await careApi.addAppointment({
        providerId,
        referralId: linked?.id,
        scheduledAt: new Date(`${date}T${time}`).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setFailure(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Could not save this appointment.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-brand-teal">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 className="text-panel-title font-semibold">Add an appointment</h2>
        {failure && <Alert status="danger" title="Not saved">{failure}</Alert>}
        <label className="flex flex-col gap-1.5">
          <span className="text-secondary font-medium">Doctor</span>
          <select className={selectClass} value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-invalid={touched && !providerId ? true : undefined}>
            <option value="">{directory.data ? "Choose a doctor" : "Loading doctors…"}</option>
            {[...options.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.specialties[0]}, {p.clinic.city}
              </option>
            ))}
          </select>
          {touched && !providerId && <span className="text-secondary text-danger">Choose the doctor you booked with</span>}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={touched && !date ? "Enter the appointment date" : undefined} />
          <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={touched && !time ? "Enter the time" : undefined} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-secondary font-medium">Notes (optional)</span>
          <textarea className={textareaClass} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to bring, questions to ask, booking reference" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Save appointment
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
