"use client";

import { type ReactNode, useState } from "react";
import { Alert, Button, Card, StatusBadge, TextField } from "@nora/ui";
import { Loading, LoadError, PageShell, SectionTitle } from "@/components/page";
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
      title="Platform operations"
      width="narrow"
      description="Watch system health and pause a capability for every organisation at once, for example during an incident with an AI provider. Each change is attributed to you and logged."
    >
      <Health />
      <section aria-labelledby="flags-h" className="flex flex-col gap-3">
        <SectionTitle id="flags-h">Kill switches</SectionTitle>
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
      </section>
    </PageShell>
  );
}

function age(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-secondary font-medium">{label}</p>
        <p className="text-meta text-fg-muted">{children}</p>
      </div>
      <span className="shrink-0">
        <StatusBadge status={ok ? "success" : "warning"}>{ok ? "OK" : "Attention"}</StatusBadge>
      </span>
    </li>
  );
}

function Health() {
  const { data, error, loading, reload } = useLoad(careApi.platformHealth);
  const ai = data?.ai;
  const aiOk = !!ai && (!ai.enabled || (ai.configured && ai.available));
  return (
    <section aria-labelledby="health-h" className="flex flex-col gap-3">
      <SectionTitle
        id="health-h"
        actions={
          <Button variant="ghost" loading={loading && !!data} onClick={reload}>
            Refresh
          </Button>
        }
      >
        System health
      </SectionTitle>
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <Card>
          <ul>
            <Row label="Database" ok={data.database.ok && data.database.latencyMs < 250}>
              Responded in {data.database.latencyMs} ms
            </Row>
            <Row label="Cache and rate limits (Redis)" ok={data.redis.ok}>
              {data.redis.ok ? `Responded in ${data.redis.latencyMs} ms` : "Not responding. Rate limits fall back to defaults."}
            </Row>
            <Row label="Assessment queue" ok={data.queue.failed24h === 0 && (data.queue.oldestPendingSeconds ?? 0) < 120}>
              {data.queue.pending} waiting · {data.queue.running} running · {data.queue.failed24h} failed in 24 h
              {data.queue.oldestPendingSeconds !== null ? ` · oldest waiting ${age(data.queue.oldestPendingSeconds)}` : ""}
            </Row>
            <Row label="Assessments in the last 24 h" ok={data.assessments24h.fellBack === 0}>
              {data.assessments24h.total} total · {data.assessments24h.ai} AI-written · {data.assessments24h.template} standard guidance · {data.assessments24h.rules} safety-rule only
              {data.assessments24h.fellBack ? ` · ${data.assessments24h.fellBack} fell back to standard guidance (AI failed or was rejected)` : ""}
              {data.assessments24h.medianMs !== null ? ` · median ${(data.assessments24h.medianMs / 1000).toFixed(1)}s, p95 ${((data.assessments24h.p95Ms ?? 0) / 1000).toFixed(1)}s` : ""}
            </Row>
            <Row label="AI" ok={aiOk}>
              {!ai!.enabled
                ? "Paused by kill switch. Results use approved guidance."
                : !ai!.configured
                  ? "No provider key configured. Results use approved guidance."
                  : ai!.active
                    ? `Checks are using ${ai!.providers.find((p) => p.name === ai!.active)?.label ?? ai!.active}.`
                    : `Every provider is rate-limited until ${formatDate(ai!.pausedUntil!, true)}. Results use approved guidance meanwhile.`}
            </Row>
            {ai!.enabled &&
              ai!.providers.map((p, i) => (
                <Row key={p.name} label={`${i === 0 ? "Primary" : "Fallback"}: ${p.label} · ${p.model}`} ok={p.available && !(p.lastErrorAt && (!p.lastSuccessAt || p.lastErrorAt > p.lastSuccessAt))}>
                  {p.pausedUntil
                    ? `Rate-limited until ${formatDate(p.pausedUntil, true)}.`
                    : p.lastErrorAt && (!p.lastSuccessAt || p.lastErrorAt > p.lastSuccessAt)
                      ? `Last call failed ${formatDate(p.lastErrorAt, true)}.`
                      : p.lastSuccessAt
                        ? `Last successful call ${formatDate(p.lastSuccessAt, true)}.`
                        : "Ready. No calls since the server started."}
                  {p.lastError && p.lastErrorAt && (!p.lastSuccessAt || p.lastErrorAt > p.lastSuccessAt) ? ` ${p.lastError.split("\n")[0]!.slice(0, 160)}` : ""}
                </Row>
              ))}
            <Row label="Knowledge sources" ok={data.knowledge.overdue.length === 0}>
              {data.knowledge.approved} approved
              {data.knowledge.overdue.length ? ` · overdue for review: ${data.knowledge.overdue.map((d) => d.title).join(", ")}` : " · none overdue"}
              {data.knowledge.dueSoon.length ? ` · due within 30 days: ${data.knowledge.dueSoon.length}` : ""}
            </Row>
          </ul>
          <p className="mt-2 text-meta text-fg-muted">Checked {formatDate(data.checkedAt, true)}</p>
        </Card>
      )}
    </section>
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
