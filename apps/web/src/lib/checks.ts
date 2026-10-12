import { api } from "./api";

export type UrgencyLevel = "self_care" | "routine" | "soon" | "urgent" | "emergency";
export type CheckStatus = "DRAFT" | "COLLECTING" | "AWAITING_CONFIRMATION" | "ASSESSING" | "COMPLETED" | "INCOMPLETE" | "ESCALATED" | "ARCHIVED";
export type AnswerValue = "yes" | "no" | "unsure" | number | string[] | null;

export interface EmergencyContacts {
  number: string;
  crisisLine: { name: string; number: string } | null;
}

export interface QuestionView {
  id: string;
  text: string;
  why: string | null;
  type: "yes_no" | "multi" | "number";
  unit: string | null;
  min: number | null;
  max: number | null;
  allowSkip: boolean;
  options: { value: string; label: string; exclusive: boolean }[];
}

export interface FindingItem {
  key: string;
  label: string;
  value?: number | null;
  unit?: string;
  source: string;
}

export interface EvidenceRef {
  citationId: string;
  title: string;
  publisher: string;
  heading: string | null;
  excerpt: string;
  url: string | null;
}

export interface CarePlanItem {
  id: string;
  kind: string;
  text: string;
  timeframe?: string;
  citations: string[];
  watch?: boolean;
  whileWaiting?: boolean;
}

export interface CheckResult {
  status: "COMPLETED" | "INCOMPLETE" | "ESCALATED" | "UNSUPPORTED";
  urgency: { level: UrgencyLevel; title: string; text: string; reasons: { ruleId: string; message: string; citations: string[] }[] };
  summary: string;
  concerns: { code: string; label: string }[];
  findings: { present: FindingItem[]; absent: FindingItem[]; unknown: FindingItem[] };
  explanations: {
    code: string;
    label: string;
    plain: string;
    clinical: string;
    likelihood: "more_likely" | "possible" | "less_likely";
    rationale: string;
    citations: string[];
    caution?: string;
  }[];
  /** `watch` and `whileWaiting` are missing on results saved before they existed. */
  carePlan: CarePlanItem[];
  answerConflicts?: { key: string; label: string; answered: "yes" | "no"; mentioned: "yes" | "no"; resolution: "kept_answer" | "treated_as_present" }[];
  questionsForClinician: string[];
  missingInformation: { key: string; label: string }[];
  limitations: string[];
  handoff: { recommended: boolean; specialty: string | null; timeframe: string };
  evidence: EvidenceRef[];
  disclaimer: string;
  generator: "llm" | "template" | "template_fallback" | "rules";
  model: string | null;
  createdAt: string;
  memory?: { id: string; kind: MemoryKind; label: string; text: string; href: string; checkId?: string; used: boolean }[];
}

export type MemoryKind = "about" | "condition" | "medicine" | "allergy" | "past_check" | "appointment";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  label: string;
  text: string;
  recordedAt: string | null;
  href: string;
  checkId?: string;
  urgency?: UrgencyLevel | null;
}

export interface CheckMessage {
  id: string;
  sender: "patient" | "nora";
  kind: "text" | "answer" | "question" | "result" | "error" | "review" | "notice";
  text: string;
  questionId: string | null;
  createdAt: string;
}

export interface CheckView {
  id: string;
  status: CheckStatus;
  title: string | null;
  urgency: UrgencyLevel | null;
  inputVersion: number;
  turnCount: number;
  createdAt: string;
  messages: CheckMessage[];
  pendingQuestion: QuestionView | null;
  result: CheckResult | null;
  lastEventSequence: string;
  emergency: EmergencyContacts;
  review: {
    status: "pending" | "reviewed" | "corrected";
    clinician: string | null;
    correctedUrgency: UrgencyLevel | null;
    patientNote: string | null;
    reviewedAt: string | null;
  } | null;
  carePlanDone: string[];
  parent: { id: string; title: string | null; createdAt: string; urgency: UrgencyLevel | null; urgencyTitle: string | null; summary: string | null } | null;
}

export interface CheckEvent {
  sequence: string;
  type: "created" | "queued" | "stage" | "question" | "result" | "error";
  payload: { stage?: string; round?: number; attempt?: number };
  createdAt: string;
}

export interface ConsentNotice {
  purpose: "PROCESSING" | "CLINICIAN_SHARING" | "VOICE" | "ANALYTICS";
  title: string;
  body: string;
  version: string;
  required: boolean;
  granted: boolean;
}

const key = () => crypto.randomUUID();

export const checksApi = {
  create: (parentId?: string) => api<CheckView>("/checks", { method: "POST", body: { idempotencyKey: key(), ...(parentId ? { parentId } : {}) } }),
  get: (id: string) => api<CheckView>(`/checks/${id}`),
  acknowledge: (id: string, itemId: string, done: boolean) => api<CheckView>(`/checks/${id}/care-plan/${encodeURIComponent(itemId)}`, { method: "POST", body: { done } }),
  memory: () => api<{ items: MemoryItem[] }>("/memory"),
  send: (id: string, text: string) => api<CheckView>(`/checks/${id}/messages`, { method: "POST", body: { text, idempotencyKey: key() } }),
  answer: (id: string, questionId: string, inputVersion: number, value: AnswerValue) =>
    api<CheckView>(`/checks/${id}/answers`, { method: "POST", body: { questionId, inputVersion, value } }),
  events: (id: string, after: string) => api<{ status: CheckStatus; events: CheckEvent[] }>(`/checks/${id}/events?after=${after}`),
  consents: () => api<ConsentNotice[]>("/consents"),
  grantConsent: (purpose: ConsentNotice["purpose"]) => api<ConsentNotice[]>("/consents", { method: "POST", body: { purpose, granted: true } }),
};

export const TERMINAL: CheckStatus[] = ["COMPLETED", "INCOMPLETE", "ESCALATED", "ARCHIVED"];

export const STAGE_LABELS: Record<string, string> = {
  started: "Reading what you sent…",
  extracting: "Understanding your symptoms…",
  checking_safety: "Checking for warning signs…",
  escalating: "Preparing urgent guidance…",
  researching: "Looking up approved health sources…",
  searching_knowledge: "Looking up approved health sources…",
  ranking_explanations: "Weighing possible explanations…",
  drafting: "Writing your summary…",
  verifying: "Double-checking the summary for safety…",
  finalizing: "Finishing up…",
};

export const NEW_CHECK_EVENT = "nora:new-check";
export const CURRENT_CHECK_KEY = "nora.currentCheck";
