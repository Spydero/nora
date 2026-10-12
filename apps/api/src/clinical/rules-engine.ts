import {
  type BundleContent,
  type Condition,
  type ConcernDef,
  type QuestionDef,
  type UrgencyLevel,
  maxUrgency,
  urgencyRank,
} from './bundle.schema.js';

export type FactStateName = 'PRESENT' | 'ABSENT' | 'UNKNOWN' | 'DECLINED' | 'NOT_ASKED';

export interface FactValue {
  state: FactStateName;
  value?: number | null;
}

export type FactMap = Record<string, FactValue>;

export interface TriggeredRule {
  ruleId: string;
  level: UrgencyLevel;
  message: string;
  sourceKey: string;
  careItems: string[];
}

export interface UrgencyOutcome {
  level: UrgencyLevel;
  triggered: TriggeredRule[];
  defaultLevel: UrgencyLevel;
}

const isKnown = (f: FactValue | undefined) => f !== undefined && (f.state === 'PRESENT' || f.state === 'ABSENT');

/**
 * Unknown, declined and unasked facts never satisfy a positive test, so a
 * missing answer can never lower urgency on its own; callers handle missing
 * critical facts explicitly.
 */
export function evaluate(condition: Condition, facts: FactMap): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluate(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, facts));
  if ('not' in condition) return !evaluate(condition.not, facts);
  const fact = facts[condition.fact];
  if ('is' in condition) {
    switch (condition.is) {
      case 'present':
        return fact?.state === 'PRESENT';
      case 'absent':
        return fact?.state === 'ABSENT';
      case 'known':
        return isKnown(fact);
      case 'unknown':
        return !isKnown(fact);
    }
  }
  if (fact?.state !== 'PRESENT' || fact.value === null || fact.value === undefined) return false;
  const v = fact.value;
  if (condition.eq !== undefined && v !== condition.eq) return false;
  if (condition.gte !== undefined && !(v >= condition.gte)) return false;
  if (condition.gt !== undefined && !(v > condition.gt)) return false;
  if (condition.lte !== undefined && !(v <= condition.lte)) return false;
  if (condition.lt !== undefined && !(v < condition.lt)) return false;
  return true;
}

export function detectConcerns(bundle: BundleContent, facts: FactMap): ConcernDef[] {
  return bundle.concerns.filter((c) => c.triggers.some((t) => facts[t]?.state === 'PRESENT'));
}

export function evaluateUrgency(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): UrgencyOutcome {
  const codes = new Set(concerns.map((c) => c.code));
  const triggered: TriggeredRule[] = bundle.urgencyRules
    .filter((r) => !r.concerns || r.concerns.some((c) => codes.has(c)))
    .filter((r) => evaluate(r.when, facts))
    .map((r) => ({ ruleId: r.id, level: r.level, message: r.message, sourceKey: r.sourceKey, careItems: r.careItems }))
    .sort((a, b) => urgencyRank(b.level) - urgencyRank(a.level));

  const defaultLevel = concerns.reduce<UrgencyLevel>((acc, c) => maxUrgency(acc, c.defaultLevel), 'self_care');
  const level = triggered.reduce<UrgencyLevel>((acc, t) => maxUrgency(acc, t.level), defaultLevel);
  return { level, triggered, defaultLevel };
}

export function hasEmergency(outcome: UrgencyOutcome): boolean {
  return outcome.level === 'emergency';
}

export interface ScopeOutcome {
  inScope: boolean;
  exclusionId?: string;
  message?: string;
}

export function checkScope(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): ScopeOutcome {
  for (const x of bundle.exclusions) {
    if (evaluate(x.when, facts)) return { inScope: false, exclusionId: x.id, message: x.message };
  }
  if (concerns.length === 0) {
    return {
      inScope: false,
      exclusionId: 'x_unsupported_concern',
      message: `Nora can currently help with: ${bundle.concerns.map((c) => c.label.toLowerCase()).join(', ')}. For anything else, please speak with a doctor.`,
    };
  }
  return { inScope: true };
}

export function questionFactKeys(q: QuestionDef): string[] {
  if (q.type === 'multi') return (q.options ?? []).flatMap((o) => (o.factKey ? [o.factKey] : []));
  return q.factKey ? [q.factKey] : [];
}

function isResolved(q: QuestionDef, facts: FactMap): boolean {
  const keys = questionFactKeys(q);
  if (keys.length === 0) return true;
  if (q.type === 'multi') return keys.every((k) => facts[k] && facts[k].state !== 'NOT_ASKED');
  const f = facts[keys[0]!];
  return f !== undefined && f.state !== 'NOT_ASKED';
}

/**
 * Screening (age, red flags) always comes first; then concern questions in
 * bundle order, skipping anything the patient already told us.
 */
export function nextQuestion(
  bundle: BundleContent,
  facts: FactMap,
  concerns: ConcernDef[],
  asked: ReadonlySet<string>,
): { id: string; question: QuestionDef } | null {
  const ordered = [...bundle.screeningQuestions, ...concerns.flatMap((c) => c.questions)];
  const seen = new Set<string>();
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    const q = bundle.questions[id];
    if (!q || asked.has(id)) continue;
    if (q.askIf && !evaluate(q.askIf, facts)) continue;
    if (isResolved(q, facts)) continue;
    return { id, question: q };
  }
  return null;
}

export function missingRequiredFacts(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): string[] {
  const keys = new Set(concerns.flatMap((c) => c.requiredFacts));
  return [...keys].filter((k) => !isKnown(facts[k]) && bundle.facts[k]);
}

export interface SentinelResult {
  id: string;
  description: string;
  expected: UrgencyLevel;
  actual: UrgencyLevel;
  passed: boolean;
  critical: boolean;
}

export function runSentinels(bundle: BundleContent): { passed: boolean; results: SentinelResult[] } {
  const results = bundle.sentinels.map((s) => {
    const facts: FactMap = { age: { state: 'PRESENT', value: s.age } };
    for (const [k, v] of Object.entries(s.facts)) {
      facts[k] = typeof v === 'number' ? { state: 'PRESENT', value: v } : { state: v };
    }
    const concerns = s.concern
      ? bundle.concerns.filter((c) => c.code === s.concern)
      : detectConcerns(bundle, facts);
    const actual = evaluateUrgency(bundle, facts, concerns).level;
    const passed = s.critical ? urgencyRank(actual) >= urgencyRank(s.expectedLevel) : actual === s.expectedLevel;
    return { id: s.id, description: s.description, expected: s.expectedLevel, actual, passed, critical: s.critical };
  });
  return { passed: results.every((r) => r.passed), results };
}
