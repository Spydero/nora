"use client";

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Alert, Button, Card, cn, TextField } from "@nora/ui";
import { Loading, LoadError, PageShell, selectClass } from "@/components/page";
import { ApiError, type FieldError } from "@/lib/api";
import { careApi, formatDate, isoDay, type HealthList, type ListState, type PatientProfile, type ProfileInput } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

type Form = Omit<ProfileInput, "expectedVersion">;

const LIST_STATES: { value: ListState; label: string }[] = [
  { value: "known", label: "I have some" },
  { value: "none", label: "None" },
  { value: "unknown", label: "Not sure" },
  { value: "declined", label: "Prefer not to say" },
];

const LISTS: { key: "conditions" | "medications" | "allergies"; label: string; hint: string; placeholder: string }[] = [
  { key: "conditions", label: "Long-term conditions", hint: "For example diabetes, asthma or high blood pressure.", placeholder: "Add a condition" },
  { key: "medications", label: "Regular medicines", hint: "Medicines you take most days, including supplements.", placeholder: "Add a medicine" },
  { key: "allergies", label: "Allergies", hint: "Medicines, foods or other things you react to.", placeholder: "Add an allergy" },
];

function toForm(p: PatientProfile): Form {
  return {
    displayName: p.displayName,
    dateOfBirth: p.dateOfBirth,
    sexAtBirth: p.sexAtBirth,
    pregnancyStatus: p.pregnancyStatus,
    conditions: p.conditions,
    medications: p.medications,
    allergies: p.allergies,
    city: p.city,
    preferredLanguage: p.preferredLanguage,
  };
}

export default function SettingsPage() {
  const { data, error, loading, reload, setData } = useLoad(careApi.profile);
  const [form, setForm] = useState<Form | null>(null);
  const [formVersion, setFormVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  if (data && formVersion !== data.version) {
    setFormVersion(data.version);
    setForm(toForm(data));
  }

  if (!data || !form) {
    return (
      <PageShell title="Preferences" width="narrow">
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading />}
      </PageShell>
    );
  }

  const fieldError = (field: string) => failure?.fields.find((f: FieldError) => f.field === field)?.message;
  const update = (patch: Partial<Form>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    setSaving(true);
    setFailure(null);
    try {
      const next = await careApi.saveProfile({ ...form, city: form.city?.trim() || null, expectedVersion: data.version });
      setData(next);
      setSaved(true);
    } catch (err) {
      setFailure(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Something went wrong. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Preferences"
      width="narrow"
      description="Nora uses these details to skip questions you have already answered and to flag anything that changes how urgent a symptom is. Only you and, if you allow it, your clinicians can see them."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {saved && (
          <Alert status="success" title="Preferences saved">
            Your next check will use these details{data.updatedAt ? ` (version ${data.version}, ${formatDate(data.updatedAt, true)})` : ""}.
          </Alert>
        )}
        {failure?.code === "STALE_PROFILE" ? (
          <Alert status="warning" title="Your details changed somewhere else">
            <p>Reload to see the latest version, then make your changes again.</p>
            <Button variant="secondary" className="mt-3" onClick={() => { setFailure(null); reload(); }}>
              Reload
            </Button>
          </Alert>
        ) : (
          failure && failure.fields.length === 0 && <Alert status="danger" title="Not saved">{failure.message}</Alert>
        )}

        <Card className="flex flex-col gap-4">
          <h2 className="text-panel-title font-semibold">About you</h2>
          <TextField label="Name" value={form.displayName} onChange={(e) => update({ displayName: e.target.value })} error={fieldError("displayName")} autoComplete="name" required />
          <p className="-mt-2 text-meta text-fg-muted">Signed in as {data.email}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Date of birth"
              type="date"
              value={form.dateOfBirth ?? ""}
              max={isoDay(new Date().toISOString())}
              onChange={(e) => update({ dateOfBirth: e.target.value || null })}
              error={fieldError("dateOfBirth")}
              hint="Age changes which symptoms are urgent."
            />
            <TextField label="City" value={form.city ?? ""} onChange={(e) => update({ city: e.target.value })} error={fieldError("city")} hint="Used to suggest nearby doctors." autoComplete="address-level2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-secondary font-medium">Sex assigned at birth</span>
              <select
                className={selectClass}
                value={form.sexAtBirth}
                onChange={(e) => {
                  const sexAtBirth = e.target.value as Form["sexAtBirth"];
                  update({ sexAtBirth, ...(sexAtBirth === "MALE" ? { pregnancyStatus: "NOT_APPLICABLE" as const } : {}) });
                }}
              >
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="INTERSEX">Intersex</option>
                <option value="UNKNOWN">Prefer not to say</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-secondary font-medium">Pregnancy</span>
              <select
                className={selectClass}
                value={form.pregnancyStatus}
                disabled={form.sexAtBirth === "MALE"}
                onChange={(e) => update({ pregnancyStatus: e.target.value as Form["pregnancyStatus"] })}
              >
                <option value="NOT_PREGNANT">Not pregnant</option>
                <option value="PREGNANT">Pregnant</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
                <option value="UNKNOWN">Not sure</option>
              </select>
              {fieldError("pregnancyStatus") && <span className="text-secondary text-danger">{fieldError("pregnancyStatus")}</span>}
            </label>
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <div>
            <h2 className="text-panel-title font-semibold">Health background</h2>
            <p className="text-secondary text-fg-muted">“None” and “Not sure” mean different things to a clinician, so please choose the one that fits.</p>
          </div>
          {LISTS.map((list) => (
            <ListEditor key={list.key} label={list.label} hint={list.hint} placeholder={list.placeholder} value={form[list.key]} onChange={(value) => update({ [list.key]: value })} error={fieldError(`${list.key}.items`)} />
          ))}
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saving}>
            Save preferences
          </Button>
          <Button variant="ghost" disabled={saving || loading} onClick={() => { setForm(toForm(data)); setSaved(false); setFailure(null); }}>
            Discard changes
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

function ListEditor({
  label,
  hint,
  placeholder,
  value,
  onChange,
  error,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: HealthList;
  onChange(value: HealthList): void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const item = draft.trim();
    if (!item || value.items.some((i) => i.toLowerCase() === item.toLowerCase())) return setDraft("");
    onChange({ state: "known", items: [...value.items, item].slice(0, 20) });
    setDraft("");
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-card-title font-semibold">{label}</legend>
      <p className="text-meta text-fg-muted">{hint}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {LIST_STATES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={value.state === s.value}
            onClick={() => onChange({ state: s.value, items: s.value === "known" ? value.items : [] })}
            className={cn(
              "min-h-11 rounded-control border px-3 text-secondary font-medium",
              value.state === s.value ? "border-brand-teal bg-brand-teal text-fg-inverse" : "border-line-strong bg-panel hover:bg-subtle",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {value.state === "known" && (
        <>
          {value.items.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {value.items.map((item) => (
                <li key={item} className="inline-flex items-center gap-1 rounded-control bg-subtle py-1 pl-2.5 pr-1 text-secondary">
                  {item}
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    onClick={() => onChange({ state: "known", items: value.items.filter((i) => i !== item) })}
                    className="grid size-7 place-items-center rounded-control text-fg-muted hover:bg-panel hover:text-fg"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              aria-label={placeholder}
              value={draft}
              maxLength={80}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className="min-h-11 flex-1 rounded-control border border-line-strong bg-panel px-3 text-body placeholder:text-fg-muted"
            />
            <Button variant="secondary" onClick={add} disabled={!draft.trim()}>
              <Plus aria-hidden className="size-4" />
              Add
            </Button>
          </div>
          {value.items.length === 0 && <p className="text-meta text-warning">Add at least one, or choose “None” or “Not sure”.</p>}
        </>
      )}
      {error && <p className="text-secondary text-danger">{error}</p>}
    </fieldset>
  );
}
