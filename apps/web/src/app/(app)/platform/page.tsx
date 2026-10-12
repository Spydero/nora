"use client";

import { useState } from "react";
import { Alert, Button, Card, StatusBadge, TextField } from "@nora/ui";
import { Loading, LoadError, PageShell } from "@/components/page";
import { ApiError } from "@/lib/api";
import { careApi, formatDate, type PlatformFlag } from "@/lib/care";
import { useLoad } from "@/lib/use-load";

const FLAG_INFO: Record<string, { label: string; effect: string }> = {
  assessment: { label: "Symptom checks", effect: "Patients in every organisation are told checks are unavailable and shown emergency contacts instead." },
  ai_generation: { label: "AI-written explanations", effect: "Results use Nora’s approved templates only. Urgency still comes from the safety rules." },
  provider_handoff: { label: "Booking handoff", effect: "Doctors stay visible but patients cannot open booking pages from Nora." },
};

export default function PlatformPage() {
  const { data, error, reload, setData } = useLoad(careApi.platformFlags);
  return (
    <PageShell
      title="Platform kill switches"
      width="narrow"
      description="Pause a capability for every organisation at once, for example during an incident with an AI provider. Each change is attributed to you and logged."
    >
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((f) => (
            <li key={f.key}>
              <FlagCard flag={f} onChange={setData} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function FlagCard({ flag, onChange }: { flag: PlatformFlag; onChange(flags: PlatformFlag[]): void }) {
  const info = FLAG_INFO[flag.key] ?? { label: flag.key, effect: "" };
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function set(enabled: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      onChange(await careApi.setPlatformFlag(flag.key, enabled, enabled ? undefined : reason.trim()));
      setPausing(false);
      setReason("");
    } catch (err) {
      setFailure(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Could not change this switch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-card-title font-semibold">{info.label}</p>
          <p className="text-secondary text-fg-muted">When paused: {info.effect}</p>
        </div>
        <span className="shrink-0">
          <StatusBadge status={flag.enabled ? "success" : "danger"}>{flag.enabled ? "Running" : "Paused"}</StatusBadge>
        </span>
      </div>
      {!flag.enabled && flag.reason && (
        <Alert status="warning" title="Why it’s paused">
          {flag.reason}
          {flag.updatedAt ? ` · since ${formatDate(flag.updatedAt, true)}` : ""}
        </Alert>
      )}
      {failure && <Alert status="danger" title="Not changed">{failure}</Alert>}
      {flag.enabled ? (
        pausing ? (
          <div className="flex flex-col gap-3">
            <TextField label="Reason (shown to other operators)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => set(false)}>
                Pause for all organisations
              </Button>
              <Button variant="ghost" onClick={() => setPausing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setPausing(true)}>
              Pause
            </Button>
          </div>
        )
      ) : (
        <div>
          <Button loading={busy} onClick={() => set(true)}>
            Resume
          </Button>
        </div>
      )}
    </Card>
  );
}
