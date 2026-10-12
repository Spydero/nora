"use client";

import { useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Button, Card, StatusBadge, TextField } from "@nora/ui";
import { Loading, LoadError, PageShell, SectionTitle } from "@/components/page";
import { ApiError } from "@/lib/api";
import { careApi, formatDate, isoDay, type PrivacyRequest } from "@/lib/care";
import type { ConsentNotice } from "@/lib/checks";
import { useLoad } from "@/lib/use-load";

const WITHDRAW_EFFECT: Record<ConsentNotice["purpose"], string> = {
  PROCESSING: "You will not be able to start new symptom checks until you allow this again. Your existing records are kept until you ask us to delete them.",
  CLINICIAN_SHARING: "Clinicians at your organisation will no longer see new checks for review.",
  ANALYTICS: "Nora will stop recording anonymous usage events for you.",
  VOICE: "Voice input will be turned off for your account.",
};

const ORDER: ConsentNotice["purpose"][] = ["PROCESSING", "CLINICIAN_SHARING", "ANALYTICS", "VOICE"];

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

export default function PrivacyPage() {
  const requests = useLoad(careApi.privacyRequests);
  return (
    <PageShell
      title="Privacy controls"
      width="narrow"
      description="Choose how Nora may use your health information, download a copy of everything we hold, or ask us to delete it."
    >
      <Consents />
      <ExportData onExported={requests.reload} />
      <Deletion requests={requests} />
    </PageShell>
  );
}

function Consents() {
  const { data, error, reload, setData } = useLoad(careApi.consents);
  const [confirming, setConfirming] = useState<ConsentNotice["purpose"] | null>(null);
  const [busy, setBusy] = useState<ConsentNotice["purpose"] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function set(purpose: ConsentNotice["purpose"], granted: boolean) {
    setBusy(purpose);
    setFailure(null);
    try {
      setData(await careApi.setConsent(purpose, granted));
      setConfirming(null);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="consent-h" className="flex flex-col gap-3">
      <SectionTitle id="consent-h">How Nora uses your information</SectionTitle>
      {failure && <Alert status="danger" title="Not changed">{failure}</Alert>}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <ul className="flex flex-col gap-2">
          {[...data].sort((a, b) => ORDER.indexOf(a.purpose) - ORDER.indexOf(b.purpose)).map((n) => (
            <li key={n.purpose}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {n.title}
                      {n.required && <span className="ml-2 text-meta font-medium text-fg-muted">Needed for symptom checks</span>}
                    </p>
                    <p className="text-meta text-fg-muted">Notice version {n.version}</p>
                  </div>
                  <StatusBadge status={n.granted ? "success" : "info"}>{n.granted ? "Allowed" : "Not allowed"}</StatusBadge>
                </div>
                <details>
                  <summary className="cursor-pointer text-secondary font-medium text-brand-teal">Read the notice</summary>
                  <p className="mt-2 whitespace-pre-line text-secondary text-fg-muted">{n.body}</p>
                </details>
                {confirming === n.purpose ? (
                  <Alert status="warning" title="Withdraw permission?">
                    <p>{WITHDRAW_EFFECT[n.purpose]}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="danger" loading={busy === n.purpose} onClick={() => set(n.purpose, false)}>
                        Withdraw
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Keep allowed
                      </Button>
                    </div>
                  </Alert>
                ) : (
                  <div>
                    {n.granted ? (
                      <Button variant="secondary" onClick={() => setConfirming(n.purpose)}>
                        Withdraw permission
                      </Button>
                    ) : (
                      <Button loading={busy === n.purpose} onClick={() => set(n.purpose, true)}>
                        Allow
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExportData({ onExported }: { onExported(): void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setFailure(null);
    try {
      const data = await careApi.exportData();
      const name = `nora-export-${isoDay(new Date().toISOString())}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(name);
      onExported();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="export-h" className="flex flex-col gap-3">
      <SectionTitle id="export-h">Download your data</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-secondary">
          A machine-readable file with your account, preferences and their history, permissions, every check with its messages and results, doctor handoffs and
          appointments you recorded.
        </p>
        {done && <Alert status="success" title="Download started">Saved as {done}. Keep it somewhere safe — it contains health information.</Alert>}
        {failure && <Alert status="danger" title="Export failed">{failure}</Alert>}
        <div>
          <Button variant="secondary" loading={busy} onClick={download}>
            <Download aria-hidden className="size-4" />
            Download my data
          </Button>
        </div>
      </Card>
    </section>
  );
}

function Deletion({ requests }: { requests: ReturnType<typeof useLoad<PrivacyRequest[]>> }) {
  const { data, error, reload, setData } = requests;
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const open = data?.find((r) => r.type === "DELETION" && r.status === "RECEIVED");

  async function run(action: () => Promise<PrivacyRequest[]>) {
    setBusy(true);
    setFailure(null);
    try {
      setData(await action());
      setConfirmText("");
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="delete-h" className="flex flex-col gap-3">
      <SectionTitle id="delete-h">Delete your data</SectionTitle>
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            {failure && <Alert status="danger" title="Not done">{failure}</Alert>}
            {open ? (
              <>
                <Alert status="warning" title="Deletion scheduled">
                  Your checks, preferences and appointments will be deleted on {formatDate(open.detail.scheduledFor ?? open.createdAt)}. You can cancel until then.
                </Alert>
                <div>
                  <Button variant="secondary" loading={busy} onClick={() => run(() => careApi.cancelRequest(open.id))}>
                    Cancel deletion
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-secondary">
                  We wait 30 days before deleting so you can change your mind. Records we must keep by law, such as access logs, are kept without your health
                  details.
                </p>
                <TextField label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="max-w-xs" />
                <div>
                  <Button variant="danger" disabled={confirmText !== "DELETE"} loading={busy} onClick={() => run(careApi.requestDeletion)}>
                    <Trash2 aria-hidden className="size-4" />
                    Request deletion
                  </Button>
                </div>
              </>
            )}
          </Card>
          {data.length > 0 && (
            <details className="rounded-card border border-line bg-panel p-4">
              <summary className="cursor-pointer text-secondary font-medium">
                <ShieldCheck aria-hidden className="mr-1 inline size-4 text-brand-teal" />
                Request history ({data.length})
              </summary>
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {data.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2 text-secondary">
                    <span>{r.type === "EXPORT" ? "Data download" : "Deletion request"}</span>
                    <span className="text-fg-muted">
                      {r.status === "COMPLETED" ? "Completed" : r.status === "CANCELLED" ? "Cancelled" : "In progress"} · {formatDate(r.createdAt, true)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
