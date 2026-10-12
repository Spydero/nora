import type { UrgencyLevel } from '../clinical/bundle.schema.js';

export interface EvidenceRef {
  citationId: string;
  chunkId: string;
  documentId: string;
  sourceKey: string;
  version: number;
  title: string;
  publisher: string;
  heading: string | null;
  excerpt: string;
  url: string | null;
}

export interface FindingItem {
  key: string;
  label: string;
  value?: number | null;
  unit?: string;
  source: string;
}

export interface AnswerConflict {
  key: string;
  label: string;
  answered: 'yes' | 'no';
  mentioned: 'yes' | 'no';
  /** A confirmed answer is kept, except that a warning sign mentioned later is treated as present to be safe. */
  resolution: 'kept_answer' | 'treated_as_present';
  /** Set when the earlier answer came from the patient's health profile rather than this check. */
  answeredIn?: 'profile';
}

export type ResultStatus = 'COMPLETED' | 'INCOMPLETE' | 'ESCALATED' | 'UNSUPPORTED';
export type Generator = 'llm' | 'template' | 'template_fallback' | 'rules';

export interface ResultContent {
  schemaVersion: '1';
  status: ResultStatus;
  urgency: {
    level: UrgencyLevel;
    title: string;
    text: string;
    reasons: { ruleId: string; message: string; citations: string[] }[];
  };
  summary: string;
  concerns: { code: string; label: string }[];
  /** Symptoms in this consultation only; `history` holds long-term conditions and medicines that mattered for it. */
  findings: { present: FindingItem[]; absent: FindingItem[]; unknown: FindingItem[]; history?: { present: FindingItem[]; absent: FindingItem[]; unknown: FindingItem[] } };
  explanations: {
    code: string;
    label: string;
    plain: string;
    clinical: string;
    likelihood: 'more_likely' | 'possible' | 'less_likely';
    rationale: string;
    citations: string[];
    /** Shown when the approved description sounds reassuring but the urgency rules found warning signs. */
    caution?: string;
  }[];
  /** Later messages that disagreed with an earlier yes/no answer, and what Nora did about it. */
  answerConflicts?: AnswerConflict[];
  carePlan: {
    id: string;
    kind: string;
    text: string;
    timeframe?: string;
    citations: string[];
    /** A "get help if…" warning to watch for, not a task. */
    watch?: boolean;
    /** Comfort only until the patient is seen; never a substitute for the recommended care. */
    whileWaiting?: boolean;
  }[];
  questionsForClinician: string[];
  missingInformation: { key: string; label: string }[];
  limitations: string[];
  handoff: { recommended: boolean; specialty: string | null; timeframe: string };
  evidence: EvidenceRef[];
  disclaimer: string;
  emergency: { number: string; crisisLine: { name: string; number: string } | null };
  generator: Generator;
  model: string | null;
  verification: { passed: boolean; attempts: number; issues: string[] };
  /** Confirmed records Nora took into account; `used` marks items the explanation relied on. Absent on results saved before memory existed. */
  memory?: { id: string; kind: string; label: string; text: string; href: string; checkId?: string; used: boolean }[];
  /** How the urgency was decided. AI output is written afterwards and never changes it. Absent on older results. */
  triage?: {
    decidedBy: 'rules';
    missingSafety: { key: string; label: string; gap: 'unsure' | 'skipped' | 'not_asked' }[];
  };
  /** A recent check for the same problem and how the patient said this one relates to it. */
  episode?: EpisodeContext;
}

export interface EpisodeContext {
  earlier: { checkId?: string; text: string; href: string };
  answer: 'ongoing' | 'returned' | 'new' | 'unsure' | null;
  label: string;
}
