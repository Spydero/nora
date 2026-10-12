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

const DOSING = [
  /\b\d+(\.\d+)?\s?(mg|mcg|µg|ml|g|iu|tablets?|tabs?|capsules?|puffs?|drops?)\b/i,
  /\b(take|start|stop|increase|decrease|double|skip)\s+(\w+\s+){0,2}(antibiotics?|ibuprofen|paracetamol|amoxicillin|azithromycin|medications?|medicines?|dose|pills?|tablets?)\b/i,
  /\b(times|twice|three times) (a|per) day\b/i,
];

const FALSE_REASSURANCE = [
  /\b(no need|don't need|do not need|needn't)\s+(to\s+)?(see|visit|contact|call|go)\b/i,
  /\bnothing (serious|to worry)\b/i,
  /\b(definitely|certainly) (not|nothing)\b/i,
  /\bnot (urgent|serious)\b/i,
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
    if (DIAGNOSIS.some((re) => re.test(t))) issues.push(`Diagnostic language is not allowed: "${t.slice(0, 80)}"`);
    if (DOSING.some((re) => re.test(t))) issues.push(`Medicine dosing or instructions are not allowed: "${t.slice(0, 80)}"`);
    if (urgencyRank(ctx.urgency) >= urgencyRank('soon') && FALSE_REASSURANCE.some((re) => re.test(t))) {
      issues.push(`Text contradicts the required urgency: "${t.slice(0, 80)}"`);
    }
  }
  return issues;
}
