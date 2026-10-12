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
  findings: { present: FindingItem[]; absent: FindingItem[]; unknown: FindingItem[] };
  explanations: {
    code: string;
    label: string;
    plain: string;
    clinical: string;
    likelihood: 'more_likely' | 'possible' | 'less_likely';
    rationale: string;
    citations: string[];
  }[];
  carePlan: { id: string; kind: string; text: string; timeframe?: string; citations: string[] }[];
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
}
