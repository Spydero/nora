import { api } from "./api";
import type { CheckResult, CheckStatus, ConsentNotice, UrgencyLevel } from "./checks";

// ── Profile ──

export type ListState = "known" | "none" | "unknown" | "declined";
export interface HealthList {
  state: ListState;
  items: string[];
}

export interface PatientProfile {
  version: number;
  email: string;
  displayName: string;
  dateOfBirth: string | null;
  sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
  pregnancyStatus: "PREGNANT" | "NOT_PREGNANT" | "NOT_APPLICABLE" | "UNKNOWN";
  conditions: HealthList;
  medications: HealthList;
  allergies: HealthList;
  city: string | null;
  preferredLanguage: "en";
  updatedAt: string | null;
}

export type ProfileInput = Omit<PatientProfile, "version" | "email" | "updatedAt"> & { expectedVersion: number };

// ── Checks history ──

export interface CheckSummary {
  id: string;
  title: string | null;
  status: CheckStatus;
  urgency: UrgencyLevel | null;
  reviewStatus: "UNREVIEWED" | "REVIEWED" | "CORRECTED" | null;
  createdAt: string;
  updatedAt: string;
}

// ── Privacy ──

export interface PrivacyRequest {
  id: string;
  type: "EXPORT" | "DELETION";
  status: "RECEIVED" | "COMPLETED" | "CANCELLED";
  detail: { scheduledFor?: string; checks?: number };
  createdAt: string;
  completedAt: string | null;
}

// ── Medicines ──

export interface MedicineSummary {
  slug: string;
  genericName: string;
  brandExamples: string[];
  category: string;
  purpose: string;
  otc: boolean;
}

export interface Medicine extends MedicineSummary {
  commonSideEffects: string[];
  warnings: string[];
  askClinicianIf: string[];
  reviewedAt: string;
}

// ── Providers and care ──

export interface Provider {
  id: string;
  name: string;
  specialties: string[];
  languages: string[];
  qualifications: string[];
  registrationNumber: string;
  acceptingNewPatients: boolean;
  consultationModes: ("in_person" | "video")[];
  fee: { amount: number; currency: string };
  nextAvailableAt: string | null;
  scheduleUpdatedAt: string | null;
  verifiedAt: string | null;
  booking: { method: "url" | "phone"; url: string | null; phone: string | null; available: boolean };
  bio: string | null;
  clinic: { name: string; address: string; city: string; phone: string | null; accessibility: string[] };
}

export interface ProviderFacets {
  specialties: string[];
  cities: string[];
  languages: string[];
}

export interface ProviderQuery {
  q?: string;
  specialty?: string;
  city?: string;
  mode?: "in_person" | "video";
  language?: string;
}

export type AppointmentStatus = "PATIENT_REPORTED" | "ATTENDED" | "CANCELLED" | "MISSED";

export interface Appointment {
  id: string;
  referralId: string | null;
  scheduledAt: string;
  timeZone: string;
  notes: string | null;
  status: AppointmentStatus;
  createdAt: string;
  provider: Provider | null;
}

export interface Referral {
  id: string;
  status: "HANDOFF_OPENED" | "APPOINTMENT_REPORTED";
  specialty: string | null;
  createdAt: string;
  check: { id: string; title: string | null } | null;
  provider: Provider | null;
}

// ── Clinician review ──

export interface ReviewTaskSummary {
  id: string;
  status: "QUEUED" | "IN_REVIEW" | "DONE";
  version: number;
  reasons: string[];
  dueAt: string;
  overdue: boolean;
  createdAt: string;
  assignee: { id: string; name: string | null; isMe: boolean } | null;
  check: { id: string; title: string | null; urgency: UrgencyLevel | null; status: CheckStatus | null };
  patient: { name: string | null; age: number | null };
}

export interface ReviewDecision {
  id: string;
  decision: "AGREE" | "CHANGE_URGENCY";
  reason: string;
  correctedUrgency: UrgencyLevel | null;
  patientNote: string | null;
  clinician: string | null;
  createdAt: string;
}

export interface ReviewCase extends Omit<ReviewTaskSummary, "overdue" | "createdAt" | "patient" | "check"> {
  patient: {
    name: string;
    age: number | null;
    sexAtBirth: string;
    pregnancyStatus: string;
    conditions: string;
    medications: string;
    allergies: string;
  };
  check: { id: string; title: string | null; status: CheckStatus; urgency: UrgencyLevel | null; createdAt: string };
  messages: { id: string; sender: string; kind: string; text: string; createdAt: string }[];
  facts: { key: string; label: string; state: string; value: number | null; unit: string | null; source: string; quote: string | null }[];
  urgencyHistory: { level: UrgencyLevel; source: string; ruleIds: string[]; reason: string | null; createdAt: string }[];
  result: CheckResult & { reviewStatus: string };
  decisions: ReviewDecision[];
}

export interface DecisionInput {
  version: number;
  decision: "AGREE" | "CHANGE_URGENCY";
  correctedUrgency?: UrgencyLevel;
  reason: string;
  patientNote?: string;
}

// ── Administration ──

export interface AdminOverview {
  tenant: {
    name: string;
    slug: string;
    region: string;
    status: string;
    emergencyNumber: string;
    crisisLine: { name: string; number: string } | null;
    reviewSlaHours: number;
  };
  capabilities: { key: string; label: string; phase: string; available: boolean; enabled: boolean; platformEnabled: boolean }[];
  stats: { patients: number; checks7d: number; completed7d: number; escalated7d: number; openReviews: number; overdueReviews: number; referrals7d: number };
}

export interface Member {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  status: "ACTIVE" | "REVOKED";
  isMe: boolean;
  lastSignInAt: string | null;
  joinedAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  purpose: string | null;
  outcome: string;
  actor: string | null;
  subject: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AdminProvider {
  id: string;
  name: string;
  specialties: string[];
  clinic: string;
  city: string;
  status: "DRAFT" | "VERIFIED" | "PUBLISHED" | "SUSPENDED";
  verifiedAt: string | null;
  credentialExpiresAt: string | null;
}

export interface PlatformFlag {
  key: string;
  enabled: boolean;
  reason: string | null;
  updatedAt: string | null;
}

export interface ContentOverview {
  bundles: {
    id: string;
    version: string;
    status: string;
    active: boolean;
    changeNote: string | null;
    concerns: number;
    rules: number;
    questions: number;
    evaluation: { passed: boolean; sentinelsPassed: number; sentinelsTotal: number } | null;
    approvedAt: string | null;
    releasedAt: string | null;
  }[];
  documents: { id: string; title: string; publisher: string; status: string; chunks: number; concernCodes: string[]; reviewDueAt: string; reviewOverdue: boolean; url: string | null }[];
  medicines: { slug: string; genericName: string; reviewedAt: string }[];
}

export type AnalyticsRange = "7d" | "30d" | "90d";

/** Counts and rates are null when withheld because they are below the minimum count. */
export interface Analytics {
  range: AnalyticsRange;
  since: string;
  minCount: number;
  funnel: { started: number | null; completed: number | null; completionRate: number | null; followUps: number | null };
  outcomes: {
    assessed: number | null;
    urgentOrEmergency: number | null;
    unsupported: number | null;
    unsupportedRate: number | null;
    handoffs: number | null;
    handoffRate: number | null;
  };
  urgency: { level: UrgencyLevel; count: number | null }[];
  safety: { reviewsOpened: number | null; reviewsDecided: number | null; reviewsCorrected: number | null; correctionRate: number | null; medianReviewHours: number | null };
  ai: { used: number | null; fellBack: number | null; fallbackRate: number | null };
  reliability: { failedAssessments: number | null };
}

export interface AiProviderStatus {
  name: string;
  label: string;
  model: string;
  available: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
}

export interface PlatformHealth {
  checkedAt: string;
  database: { ok: boolean; latencyMs: number };
  redis: { ok: boolean; latencyMs: number | null };
  queue: { pending: number; running: number; failed24h: number; oldestPendingSeconds: number | null };
  assessments24h: { total: number; ai: number; template: number; fellBack: number; rules: number; medianMs: number | null; p95Ms: number | null };
  ai: {
    configured: boolean;
    available: boolean;
    enabled: boolean;
    active: string | null;
    pausedUntil: string | null;
    providers: AiProviderStatus[];
  };
  assessmentEnabled: boolean;
  knowledge: { approved: number; overdue: { title: string; reviewDueAt: string }[]; dueSoon: { title: string; reviewDueAt: string }[] };
}

const qs = (params: object) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? `?${new URLSearchParams(entries as [string, string][]).toString()}` : "";
};

export const careApi = {
  profile: () => api<PatientProfile>("/profile"),
  saveProfile: (input: ProfileInput) => api<PatientProfile>("/profile", { method: "PUT", body: input }),

  checks: () => api<CheckSummary[]>("/checks"),

  consents: () => api<ConsentNotice[]>("/consents"),
  setConsent: (purpose: ConsentNotice["purpose"], granted: boolean) => api<ConsentNotice[]>("/consents", { method: "POST", body: { purpose, granted } }),
  privacyRequests: () => api<PrivacyRequest[]>("/privacy/requests"),
  exportData: () => api<Record<string, unknown>>("/privacy/export", { method: "POST" }),
  requestDeletion: () => api<PrivacyRequest[]>("/privacy/deletion", { method: "POST", body: { confirm: "DELETE" } }),
  cancelRequest: (id: string) => api<PrivacyRequest[]>(`/privacy/requests/${id}/cancel`, { method: "POST" }),

  medicines: (q?: string) => api<MedicineSummary[]>(`/medicines${qs({ q })}`),
  medicine: (slug: string) => api<Medicine>(`/medicines/${encodeURIComponent(slug)}`),

  providers: (query: ProviderQuery) => api<Provider[]>(`/providers${qs(query)}`),
  providerFacets: () => api<ProviderFacets>("/providers/facets"),
  refer: (providerId: string, checkId?: string) =>
    api<{ id: string; status: string; createdAt: string; provider: Provider }>("/referrals", { method: "POST", body: { providerId, checkId } }),

  appointments: () => api<{ referrals: Referral[]; appointments: Appointment[] }>("/appointments"),
  addAppointment: (input: { providerId: string; referralId?: string; scheduledAt: string; timeZone: string; notes?: string }) =>
    api<Appointment>("/appointments", { method: "POST", body: input }),
  updateAppointment: (id: string, input: { status?: AppointmentStatus; scheduledAt?: string; notes?: string }) =>
    api<Appointment>(`/appointments/${id}`, { method: "PATCH", body: input }),

  reviewTasks: (status: "open" | "done") => api<ReviewTaskSummary[]>(`/review/tasks?status=${status}`),
  reviewCase: (id: string) => api<ReviewCase>(`/review/tasks/${id}`),
  claim: (id: string, version: number) => api<ReviewCase>(`/review/tasks/${id}/claim`, { method: "POST", body: { version } }),
  release: (id: string, version: number) => api<ReviewCase>(`/review/tasks/${id}/release`, { method: "POST", body: { version } }),
  decide: (id: string, input: DecisionInput) => api<ReviewCase>(`/review/tasks/${id}/decision`, { method: "POST", body: input }),

  adminOverview: () => api<AdminOverview>("/admin/overview"),
  setCapability: (key: string, enabled: boolean) => api<AdminOverview>(`/admin/capabilities/${key}`, { method: "PUT", body: { enabled } }),
  members: () => api<Member[]>("/admin/members"),
  setMemberStatus: (id: string, status: Member["status"]) => api<Member[]>(`/admin/members/${id}`, { method: "PATCH", body: { status } }),
  auditLog: (limit = 50) => api<AuditEntry[]>(`/admin/audit?limit=${limit}`),
  adminProviders: () => api<AdminProvider[]>("/admin/providers"),
  setProviderStatus: (id: string, status: "PUBLISHED" | "VERIFIED" | "SUSPENDED") => api<AdminProvider[]>(`/admin/providers/${id}`, { method: "PATCH", body: { status } }),

  analytics: (range: AnalyticsRange) => api<Analytics>(`/admin/analytics?range=${range}`),

  platformHealth: () => api<PlatformHealth>("/platform/health"),
  platformFlags: () => api<PlatformFlag[]>("/platform/flags"),
  setPlatformFlag: (key: string, enabled: boolean, reason?: string) => api<PlatformFlag[]>(`/platform/flags/${key}`, { method: "PUT", body: { enabled, reason } }),

  content: () => api<ContentOverview>("/content"),
};

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  emergency: "Emergency",
  urgent: "Urgent — today",
  soon: "Within 24–48 hours",
  routine: "Routine",
  self_care: "Self-care",
};

/** Every date is shown in India time so the app, the doctor summary and its PDF agree whatever the device's clock says. */
export const TIME_ZONE = "Asia/Kolkata";

export function formatDate(iso: string, withTime = false): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(new Date(iso));
}

/** YYYY-MM-DD in India time, for file names. */
export function isoDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));
}

export function clinicAddress(clinic: Provider["clinic"]): string {
  if (clinic.city === "Online") return "Online consultations";
  return clinic.address.includes(clinic.city) ? clinic.address : `${clinic.address}, ${clinic.city}`;
}

/** Provider fees are stored in minor units (paise, cents). */
export function formatFee(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 36) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
