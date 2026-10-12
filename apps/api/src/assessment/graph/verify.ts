import { type UrgencyLevel, urgencyRank } from '../../clinical/bundle.schema.js';

export interface Draft {
  summary: string;
  explanations: { code: string; likelihood: 'more_likely' | 'possible' | 'less_likely'; rationale: string; citations: string[] }[];
  questionsForClinician: string[];
}

const DIAGNOSIS = [
  /\bdiagnos(is|ed|e|ing)\b/i,
  /\byou (definitely|certainly|clearly) have\b/i,
  /\b(you have|you've got|this is|it is|it's) (a |an )?(\w+ ){0,3}(infection|migraine|appendicitis|cystitis|pneumonia|meningitis|sciatica|gastroenteritis|tonsillitis|pharyngitis|strep|uti|bronchitis|stroke|heart attack)\b/i,
];

/** Saying what Nora is not ("this is not a diagnosis") is required wording, not a diagnosis. */
const DISCLAIMER = /\b(not|never|cannot|can't|can not|isn't|is not|without|doesn't|does not)\s+(give\s+|make\s+|provide\s+|replace\s+)?(you\s+)?(a\s+|any\s+)?diagnos\w*/gi;

const DOSING = [/\b\d+(\.\d+)?\s?(mg|mcg|µg|ml|g|iu|tablets?|tabs?|capsules?|puffs?|drops?)\b/i, /\b(times|twice|three times) (a|per) day\b/i];

/** Instructions are only checked in Nora's statements; patients may ask a clinician about their medicines. */
const MEDICINE_INSTRUCTION =
  /\b(take|start|stop|increase|decrease|double|skip)\s+(\w+\s+){0,2}(antibiotics?|ibuprofen|paracetamol|amoxicillin|azithromycin|medications?|medicines?|dose|pills?|tablets?)\b/i;

const FALSE_REASSURANCE = [
  /\b(no need|don't need|do not need|needn't)\s+(to\s+)?(see|visit|contact|call|go)\b/i,
  /\bnothing (serious|to worry)\b/i,
  /\b(definitely|certainly) (not|nothing)\b/i,
  /\bnot (urgent|serious)\b/i,
];

/** Patient-facing text must speak to the patient, not about them. */
const THIRD_PERSON = [
  /\bthe (patient|user|individual|person)\b/i,
  /\b(he|she) (has|is|was|had|should|reports?|describes?|denies|needs?|may|might|can)\b/i,
  /\b(his|her) (symptoms?|throat|fever|pain|glands?|cough|headache|age)\b/i,
  /\ban? \d{1,3}[-‑ ]year[-‑ ]old\b/i,
];

export interface VerifyContext {
  candidateCodes: ReadonlySet<string>;
  citationIds: ReadonlySet<string>;
  urgency: UrgencyLevel;
}

/** Deterministic safety and provenance checks applied to every draft. */
export function verifyDraft(draft: Draft, ctx: VerifyContext): string[] {
  const issues: string[] = [];
  if (draft.explanations.length === 0) issues.push('At least one candidate explanation is required.');

  const seen = new Set<string>();
  for (const e of draft.explanations) {
    if (!ctx.candidateCodes.has(e.code)) issues.push(`Explanation "${e.code}" is not an approved candidate.`);
    if (seen.has(e.code)) issues.push(`Explanation "${e.code}" is listed twice.`);
    seen.add(e.code);
    if (e.citations.length === 0) issues.push(`Explanation "${e.code}" has no citation.`);
    for (const c of e.citations) if (!ctx.citationIds.has(c)) issues.push(`Citation ${c} was not retrieved in this run.`);
  }

  const texts = [draft.summary, ...draft.explanations.map((e) => e.rationale), ...draft.questionsForClinician];
  for (const t of texts) {
    if (DIAGNOSIS.some((re) => re.test(t.replace(DISCLAIMER, '')))) issues.push(`Diagnostic language is not allowed: "${t.slice(0, 80)}"`);
    if (DOSING.some((re) => re.test(t))) issues.push(`Medicine dosing or instructions are not allowed: "${t.slice(0, 80)}"`);
    if (urgencyRank(ctx.urgency) >= urgencyRank('soon') && FALSE_REASSURANCE.some((re) => re.test(t))) {
      issues.push(`Text contradicts the required urgency: "${t.slice(0, 80)}"`);
    }
  }
  for (const t of [draft.summary, ...draft.explanations.map((e) => e.rationale)]) {
    if (MEDICINE_INSTRUCTION.test(t)) issues.push(`Medicine dosing or instructions are not allowed: "${t.slice(0, 80)}"`);
    if (THIRD_PERSON.some((re) => re.test(t))) issues.push(`Address the patient directly as "you": "${t.slice(0, 80)}"`);
  }
  return issues;
}
