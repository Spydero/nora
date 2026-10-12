import type { BundleContent, ConcernDef, UrgencyLevel } from './bundle.schema.js';
import { evaluateUrgency, type FactMap, missingRequiredFacts, questionFactKeys, safetyFacts, type UrgencyOutcome } from './rules-engine.js';

export type SafetyGap = 'unsure' | 'skipped' | 'not_asked';

export interface TriageDecision {
  /** Always the clinical rules: AI output never reaches this function. */
  decidedBy: 'rules';
  level: UrgencyLevel;
  urgency: UrgencyOutcome;
  reasons: { ruleId: string; level: UrgencyLevel; message: string }[];
  /** Warning signs Nora couldn't rule out: ones the patient was unsure about or skipped, and the concern's own warning signs not yet asked. */
  missingSafety: { key: string; label: string; gap: SafetyGap }[];
  /** Facts the concern needs that are still unknown, so the result is less certain. */
  missingRequired: { key: string; label: string }[];
}

const gapOf = (state: string | undefined): SafetyGap | null => {
  if (state === 'UNKNOWN') return 'unsure';
  if (state === 'DECLINED') return 'skipped';
  if (state === undefined || state === 'NOT_ASKED') return 'not_asked';
  return null;
};

/**
 * Nora's urgency decision. Only bundle rules and patient facts go in, so the
 * level, its reasons and the gaps in safety information are the same whether
 * or not any AI model runs; AI explanations are written afterwards and cannot
 * change them.
 */
export function triage(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): TriageDecision {
  const urgency = evaluateUrgency(bundle, facts, concerns);
  const label = (key: string) => bundle.facts[key]?.label ?? key;
  const screened = new Set(
    concerns.flatMap((c) => c.questions.flatMap((id) => (bundle.questions[id]?.purpose === 'safety' ? questionFactKeys(bundle.questions[id]) : []))),
  );
  const missingSafety = safetyFacts(bundle, concerns).flatMap((key) => {
    const gap = gapOf(facts[key]?.state);
    if (!gap || (gap === 'not_asked' && !screened.has(key))) return [];
    return [{ key, label: label(key), gap }];
  });
  return {
    decidedBy: 'rules',
    level: urgency.level,
    urgency,
    reasons: urgency.triggered.map(({ ruleId, level, message }) => ({ ruleId, level, message })),
    missingSafety,
    missingRequired: missingRequiredFacts(bundle, facts, concerns).map((key) => ({ key, label: label(key) })),
  };
}
