"use client";

import { useState } from "react";
import { Alert, Button, Card, cn, StatusBadge } from "@nora/ui";
import { Loading, LoadError, PageShell, SectionTitle } from "@/components/page";
import { ApiError } from "@/lib/api";
import type { Role } from "@/lib/auth-context";
import { careApi, formatDate, type AdminOverview, type AdminProvider, type Member } from "@/lib/care";
import { ROLE_LABEL } from "@/lib/roles";
import { useLoad } from "@/lib/use-load";

type Tab = "overview" | "members" | "doctors" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "doctors", label: "Doctors" },
  { id: "audit", label: "Audit log" },
];

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <PageShell title="Administration" width="wide" description="Manage your organisation’s Nora: which features are on, who has access, the doctor directory and the audit trail.">
      <div role="tablist" aria-label="Administration" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px min-h-11 border-b-2 px-4 text-secondary font-medium",
              tab === t.id ? "border-brand-teal text-brand-navy" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "members" && <Members />}
      {tab === "doctors" && <Doctors />}
      {tab === "audit" && <Audit />}
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-meta font-medium text-fg-muted">{label}</p>
      <p className={cn("text-page-title font-semibold", tone === "danger" && value > 0 && "text-danger")}>{value}</p>
    </Card>
  );
}

function Overview() {
  const { data, error, reload, setData } = useLoad(careApi.adminOverview);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  async function toggle(c: AdminOverview["capabilities"][number]) {
    setBusy(c.key);
    setFailure(null);
    try {
      setData(await careApi.setCapability(c.key, !c.enabled));
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const s = data.stats;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="stats-h" className="flex flex-col gap-3">
        <SectionTitle id="stats-h">Activity</SectionTitle>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Active patients" value={s.patients} />
          <Stat label="Checks · 7 days" value={s.checks7d} />
          <Stat label="Completed · 7 days" value={s.completed7d} />
          <Stat label="Emergency · 7 days" value={s.escalated7d} />
          <Stat label="Handoffs · 7 days" value={s.referrals7d} />
          <Stat label="Open reviews" value={s.openReviews} />
          <Stat label="Overdue reviews" value={s.overdueReviews} tone="danger" />
        </div>
      </section>

      <section aria-labelledby="org-h" className="flex flex-col gap-3">
        <SectionTitle id="org-h">Organisation</SectionTitle>
        <Card className="grid gap-3 text-secondary sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-meta text-fg-muted">Name</p>
            <p className="font-medium">
              {data.tenant.name} <span className="text-fg-muted">({data.tenant.slug})</span>
            </p>
          </div>
          <div>
            <p className="text-meta text-fg-muted">Region · status</p>
            <p className="font-medium">
              {data.tenant.region} · {data.tenant.status.toLowerCase()}
            </p>
          </div>
          <div>
            <p className="text-meta text-fg-muted">Emergency number shown to patients</p>
            <p className="font-medium">
              {data.tenant.emergencyNumber}
              {data.tenant.crisisLine ? ` · ${data.tenant.crisisLine.name} ${data.tenant.crisisLine.number}` : ""}
            </p>
          </div>
          <div>
            <p className="text-meta text-fg-muted">Clinician review target</p>
            <p className="font-medium">within {data.tenant.reviewSlaHours} hours</p>
          </div>
        </Card>
      </section>

      <section aria-labelledby="cap-h" className="flex flex-col gap-3">
        <SectionTitle id="cap-h">Features</SectionTitle>
        <p className="-mt-2 text-secondary text-fg-muted">Turning a feature off takes effect immediately for everyone in your organisation. Changes are recorded in the audit log.</p>
        {failure && <Alert status="danger" title="Not changed">{failure}</Alert>}
        <ul className="grid gap-2 md:grid-cols-2">
          {data.capabilities.map((c) => (
            <li key={c.key}>
              <Card className={cn("flex items-center justify-between gap-3", !c.available && "opacity-70")}>
                <div className="min-w-0">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-meta text-fg-muted">
                    {!c.available
                      ? `Planned (${c.phase})`
                      : !c.platformEnabled
                        ? "Paused by the Nora platform team"
                        : c.enabled
                          ? "On for your organisation"
                          : "Off for your organisation"}
                  </p>
                </div>
                {c.available ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={c.enabled}
                    aria-label={c.label}
                    disabled={busy === c.key}
                    onClick={() => toggle(c)}
                    className={cn(
                      "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60",
                      c.enabled ? "bg-brand-teal" : "bg-line-strong",
                    )}
                  >
                    <span className={cn("absolute top-1 size-5 rounded-full bg-panel shadow transition-all", c.enabled ? "left-6" : "left-1")} />
                  </button>
                ) : (
                  <span className="text-meta text-fg-muted">Not available</span>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Members() {
  const { data, error, reload, setData } = useLoad(careApi.members);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  async function set(m: Member, status: Member["status"]) {
    setBusy(m.id);
    setFailure(null);
    try {
      setData(await careApi.setMemberStatus(m.id, status));
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-secondary text-fg-muted">
        {data.filter((m) => m.status === "ACTIVE").length} active members. Removing access signs the person out everywhere straight away. Administrators cannot see
        patients’ health records.
      </p>
      {failure && <Alert status="danger" title="Not changed">{failure}</Alert>}
      <div className="overflow-x-auto rounded-card border border-line bg-panel">
        <table className="w-full min-w-[720px] text-left text-secondary">
          <thead className="border-b border-line bg-subtle text-meta text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Roles</th>
              <th className="px-4 py-2 font-medium">Last sign-in</th>
              <th className="px-4 py-2 font-medium">Access</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2">
                  <p className="font-medium">
                    {m.displayName}
                    {m.isMe && <span className="ml-1 text-fg-muted">(you)</span>}
                  </p>
                  <p className="text-meta text-fg-muted">{m.email}</p>
                </td>
                <td className="px-4 py-2">{m.roles.map((r) => ROLE_LABEL[r as Role] ?? r).join(", ")}</td>
                <td className="px-4 py-2 text-fg-muted">{m.lastSignInAt ? formatDate(m.lastSignInAt, true) : "Never"}</td>
                <td className="px-4 py-2">{m.status === "ACTIVE" ? <StatusBadge status="success">Active</StatusBadge> : <StatusBadge status="danger">Removed</StatusBadge>}</td>
                <td className="px-4 py-2 text-right">
                  {!m.isMe &&
                    (m.status === "ACTIVE" ? (
                      <Button variant="ghost" loading={busy === m.id} onClick={() => set(m, "REVOKED")}>
                        Remove access
                      </Button>
                    ) : (
                      <Button variant="secondary" loading={busy === m.id} onClick={() => set(m, "ACTIVE")}>
                        Restore
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PROVIDER_STATUS: Record<AdminProvider["status"], { label: string; status: "success" | "info" | "warning" | "danger" }> = {
  PUBLISHED: { label: "Listed · taking new patients", status: "success" },
  VERIFIED: { label: "Listed · existing patients", status: "info" },
  DRAFT: { label: "Not verified", status: "warning" },
  SUSPENDED: { label: "Hidden", status: "danger" },
};

function Doctors() {
  const { data, error, reload, setData } = useLoad(careApi.adminProviders);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  async function set(p: AdminProvider, status: "PUBLISHED" | "VERIFIED" | "SUSPENDED") {
    setBusy(p.id);
    setFailure(null);
    try {
      setData(await careApi.setProviderStatus(p.id, status));
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-secondary text-fg-muted">Patients only see verified doctors whose registration has not expired. Hiding a doctor removes them from search immediately.</p>
      {failure && <Alert status="danger" title="Not changed">{failure}</Alert>}
      <div className="overflow-x-auto rounded-card border border-line bg-panel">
        <table className="w-full min-w-[760px] text-left text-secondary">
          <thead className="border-b border-line bg-subtle text-meta text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Doctor</th>
              <th className="px-4 py-2 font-medium">Clinic</th>
              <th className="px-4 py-2 font-medium">Registration valid until</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-meta text-fg-muted">{p.specialties.join(", ")}</p>
                </td>
                <td className="px-4 py-2">
                  {p.clinic}
                  <span className="text-fg-muted"> · {p.city}</span>
                </td>
                <td className="px-4 py-2 text-fg-muted">{p.credentialExpiresAt ? formatDate(p.credentialExpiresAt) : "—"}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={PROVIDER_STATUS[p.status].status}>{PROVIDER_STATUS[p.status].label}</StatusBadge>
                </td>
                <td className="px-4 py-2 text-right">
                  {p.status === "SUSPENDED" || p.status === "DRAFT" ? (
                    <Button variant="secondary" loading={busy === p.id} onClick={() => set(p, "VERIFIED")}>
                      {p.status === "DRAFT" ? "Verify and list" : "List again"}
                    </Button>
                  ) : (
                    <Button variant="ghost" loading={busy === p.id} onClick={() => set(p, "SUSPENDED")}>
                      Hide
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "review.case.read": "Opened a patient case",
  "review.claim": "Picked up a review",
  "review.release": "Returned a review to the queue",
  "review.decision": "Signed off a review",
  "profile.update": "Updated their preferences",
  "privacy.export": "Downloaded their data",
  "privacy.deletion.request": "Requested data deletion",
  "privacy.request.cancel": "Cancelled a privacy request",
  "handoff.open": "Opened a doctor’s booking page",
  "appointment.create": "Added an appointment",
  "appointment.update": "Updated an appointment",
  "capability.enable": "Turned a feature on",
  "capability.disable": "Turned a feature off",
  "member.revoke": "Removed a member’s access",
  "member.restore": "Restored a member’s access",
  "provider.status": "Changed a doctor’s listing",
  "platform_flag.enable": "Resumed a platform feature",
  "platform_flag.disable": "Paused a platform feature",
};

function Audit() {
  const { data, error, reload, loading } = useLoad(() => careApi.auditLog(100));
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-secondary text-fg-muted">Who accessed or changed what, most recent first. Health details are never stored in the log.</p>
        <Button variant="secondary" loading={loading} onClick={reload}>
          Refresh
        </Button>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-panel">
        <table className="w-full min-w-[720px] text-left text-secondary">
          <thead className="border-b border-line bg-subtle text-meta text-fg-muted">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">What</th>
              <th className="px-4 py-2 font-medium">Whose record</th>
              <th className="px-4 py-2 font-medium">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-fg-muted">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {data.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{formatDate(e.createdAt, true)}</td>
                <td className="px-4 py-2 font-medium">{e.actor ?? "System"}</td>
                <td className="px-4 py-2">
                  {ACTION_LABEL[e.action] ?? e.action}
                  {e.detail && <span className="block">{e.detail}</span>}
                  <span className="block text-meta text-fg-muted">{e.action}</span>
                </td>
                <td className="px-4 py-2">{e.subject && e.subject !== e.actor ? e.subject : "—"}</td>
                <td className="px-4 py-2 text-fg-muted">{e.purpose?.replace(/_/g, " ") ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
