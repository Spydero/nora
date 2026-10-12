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
  /** Where the fact came from: profile, answer, rules, llm, correction. */
  source?: string;
  /** The patient's own words it was read from, keeping severity and timing ("really bad cough for 2 weeks"). */
  quote?: string;
}

export type FactMap = Record<string, FactValue>;

export interface TriggeredRule {
  ruleId: string;
  level: UrgencyLevel;
  message: string;
  sourceKey: string;
  /** The passage of the source that supports the message, when the content names it. */
  sourceHeading?: string;
  /** Set when the rule awaits a clinician's decision on its threshold or level. */
  review?: string;
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

/**
 * Specific concerns win; a general one (fever, a cold) is used only when
 * nothing specific matches, and then only the first, so a fever with a sore
 * throat is assessed as a sore throat rather than as two overlapping checks.
 * Exposure concerns (a bite) are added to the symptoms, never in place of them.
 */
export function detectConcerns(bundle: BundleContent, facts: FactMap): ConcernDef[] {
  const matched = bundle.concerns.filter((c) => c.triggers.some((t) => facts[t]?.state === 'PRESENT'));
  const symptoms = matched.filter((c) => c.kind !== 'exposure');
  const exposures = matched.filter((c) => c.kind === 'exposure');
  const specific = symptoms.filter((c) => !c.onlyAlone);
  return [...(specific.length ? specific : symptoms.slice(0, 1)), ...exposures];
}

/** Each exposure's own timing fact, so two exposures never share one timeline. */
export function exposureTiming(bundle: BundleContent): Map<string, string> {
  return new Map(Object.entries(bundle.facts).flatMap(([k, f]) => (f.timing ? [[k, f.timing] as const] : [])));
}

/**
 * Timings Nora needs: those of reported exposures the bundle treats as
 * clinically significant, either a warning sign or what an exposure concern
 * is about. Other exposures keep their timing when the patient gives it.
 */
export function requiredTimings(bundle: BundleContent, facts: FactMap): string[] {
  const exposureTriggers = new Set(bundle.concerns.filter((c) => c.kind === 'exposure').flatMap((c) => c.triggers));
  return [...exposureTiming(bundle)]
    .filter(([k]) => facts[k]?.state === 'PRESENT' && (bundle.facts[k]!.critical || exposureTriggers.has(k)))
    .map(([, timing]) => timing);
}

/** Not yet asked or told; an "I'm not sure" or a skip is an answer, not an open fact. */
export const isOpen = (f: FactValue | undefined) => f === undefined || f.state === 'NOT_ASKED';

/**
 * Three-valued evaluation: `undefined` while facts that are still open could
 * decide the condition either way, so callers can tell which questions could
 * still change an outcome.
 */
export function evaluatePartial(condition: Condition, facts: FactMap): boolean | undefined {
  if ('all' in condition) {
    const parts = condition.all.map((c) => evaluatePartial(c, facts));
    if (parts.includes(false)) return false;
    return parts.every((p) => p === true) ? true : undefined;
  }
  if ('any' in condition) {
    const parts = condition.any.map((c) => evaluatePartial(c, facts));
    if (parts.includes(true)) return true;
    return parts.every((p) => p === false) ? false : undefined;
  }
  if ('not' in condition) {
    const inner = evaluatePartial(condition.not, facts);
    return inner === undefined ? undefined : !inner;
  }
  if ('is' in condition && (condition.is === 'known' || condition.is === 'unknown')) return evaluate(condition, facts);
  return isOpen(facts[condition.fact]) ? undefined : evaluate(condition, facts);
}

/** Facts a condition refers to. */
export function conditionFacts(condition: Condition): string[] {
  if ('all' in condition) return condition.all.flatMap(conditionFacts);
  if ('any' in condition) return condition.any.flatMap(conditionFacts);
  if ('not' in condition) return conditionFacts(condition.not);
  return [condition.fact];
}

/** Level a "get help if…" item calls for when one of its conditions already holds; null when none does. */
export function warningLevel(bundle: BundleContent, careItemId: string, facts: FactMap): UrgencyLevel | null {
  const hits = (bundle.careItems[careItemId]?.escalate ?? []).filter((e) => evaluate(e.when, facts));
  return hits.length ? hits.reduce<UrgencyLevel>((acc, e) => maxUrgency(acc, e.level), 'self_care') : null;
}

/** The minimum level for a warning sign that no rule accounts for. */
export const WARNING_SIGN_FLOOR: UrgencyLevel = 'soon';
/** The minimum level when the patient couldn't say whether they have a warning sign, or skipped it. */
export const UNRESOLVED_SAFETY_FLOOR: UrgencyLevel = 'soon';

/** "1 day", "3 days", "less than a day"; units are stored in the plural. */
export function quantity(value: number | null | undefined, unit: string | undefined): string {
  if (!unit) return String(value);
  if (unit === 'days' && value === 0) return 'less than a day';
  return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
}

function describe(bundle: BundleContent, keys: string[], facts: FactMap): string {
  return keys
    .map((k) => {
      const def = bundle.facts[k]!;
      return def.type === 'number' ? `${def.label.toLowerCase()}: ${quantity(facts[k]!.value, def.unit)}` : def.label.toLowerCase();
    })
    .join('; ');
}

const applicableRules = (bundle: BundleContent, concerns: ConcernDef[]) => {
  const codes = new Set(concerns.map((c) => c.code));
  return bundle.urgencyRules.filter((r) => !r.concerns || r.concerns.some((c) => codes.has(c)));
};

/**
 * Warning signs that matter for these concerns: the ones their safety
 * questions screen for, their required facts, and any critical fact a rule or
 * "get help if…" warning for them depends on.
 */
export function safetyFacts(bundle: BundleContent, concerns: ConcernDef[]): string[] {
  const keys = new Set<string>();
  for (const c of concerns) {
    for (const id of c.questions) {
      const q = bundle.questions[id];
      if (q?.purpose === 'safety') questionFactKeys(q).forEach((k) => keys.add(k));
    }
    c.requiredFacts.forEach((k) => keys.add(k));
    for (const id of c.careItems) bundle.careItems[id]?.escalate.forEach((e) => conditionFacts(e.when).forEach((k) => keys.add(k)));
  }
  for (const r of applicableRules(bundle, concerns)) conditionFacts(r.when).forEach((k) => keys.add(k));
  return [...keys].filter((k) => bundle.facts[k]?.critical && bundle.facts[k]?.type === 'boolean');
}

/** Warning signs the patient was asked about but couldn't confirm or rule out. */
export function unresolvedSafety(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): string[] {
  return safetyFacts(bundle, concerns).filter((k) => facts[k]?.state === 'UNKNOWN' || facts[k]?.state === 'DECLINED');
}

/**
 * Bundle rules decide urgency, then three guards make sure a high-risk finding
 * is never outweighed by a routine or self-care default:
 * - a "get help if…" warning for this concern that has already happened
 *   raises urgency to the level that warning calls for;
 * - a critical fact no triggered rule accounts for raises urgency to at
 *   least WARNING_SIGN_FLOOR;
 * - a warning sign the patient couldn't rule out raises urgency to at least
 *   UNRESOLVED_SAFETY_FLOOR, because Nora can't assume it is absent.
 */
export function evaluateUrgency(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): UrgencyOutcome {
  const fired = applicableRules(bundle, concerns).filter((r) => evaluate(r.when, facts));
  const triggered: TriggeredRule[] = fired.map((r) => ({
    ruleId: r.id,
    level: r.level,
    message: r.message,
    sourceKey: r.sourceKey,
    ...(r.sourceHeading ? { sourceHeading: r.sourceHeading } : {}),
    ...(r.review ? { review: r.review } : {}),
    careItems: r.careItems,
  }));
  const covered = new Set(fired.flatMap((r) => conditionFacts(r.when)));
  const present = (k: string) => facts[k]?.state === 'PRESENT';

  const watchItems = [...new Set([...concerns.flatMap((c) => c.careItems), ...fired.flatMap((r) => r.careItems)])];
  for (const id of watchItems) {
    const item = bundle.careItems[id]!;
    const level = warningLevel(bundle, id, facts);
    if (!level) continue;
    const met = [...new Set(item.escalate.filter((e) => evaluate(e.when, facts)).flatMap((e) => conditionFacts(e.when)))].filter(present);
    met.forEach((k) => covered.add(k));
    const said = met.filter((k) => bundle.facts[k]?.kind !== 'history');
    const background = met.filter((k) => bundle.facts[k]?.kind === 'history');
    const message = [
      said.length ? `You told Nora about: ${describe(bundle, said, facts)}.` : '',
      background.length ? `Your health profile lists: ${describe(bundle, background, facts)}.` : '',
      item.text,
    ]
      .filter(Boolean)
      .join(' ');
    triggered.push({
      ruleId: `warn:${id}`,
      level,
      message,
      sourceKey: item.sourceKey,
      ...(item.sourceHeading ? { sourceHeading: item.sourceHeading } : {}),
      ...(item.review ? { review: item.review } : {}),
      careItems: [],
    });
  }

  for (const [key, def] of Object.entries(bundle.facts)) {
    if (!def.critical || def.type !== 'boolean' || !present(key) || covered.has(key)) continue;
    triggered.push({
      ruleId: `warning_sign:${key}`,
      level: WARNING_SIGN_FLOOR,
      message: `${def.label} is a warning sign, so a doctor should check it.`,
      sourceKey: 'src_red_flags',
      review: 'Nora’s floor for a warning sign that no rule covers; no source sets this level.',
      careItems: [],
    });
  }

  const unresolved = unresolvedSafety(bundle, facts, concerns);
  if (unresolved.length) {
    const labels = unresolved.map((k) => bundle.facts[k]!.label.toLowerCase());
    triggered.push({
      ruleId: 'unresolved_safety',
      level: UNRESOLVED_SAFETY_FLOOR,
      message: `Nora couldn’t rule out ${labels.length > 1 ? `${labels.slice(0, -1).join('; ')} or ${labels.at(-1)}` : labels[0]}. These can be warning signs, so a doctor should check.`,
      sourceKey: 'src_red_flags',
      sourceHeading: 'When you are not sure',
      review: 'The NHS asks for urgent advice when you are not sure whether you need emergency care; Nora’s floor for a warning sign it could not rule out is 24–48 hours.',
      careItems: [],
    });
  }
  triggered.sort((a, b) => urgencyRank(b.level) - urgencyRank(a.level));

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
 * The question as the patient should see it: multi-select options the patient
 * already answered (yes, no or not sure) are dropped, so an answer can only
 * change facts that are still open.
 */
export function presentQuestion(q: QuestionDef, facts: FactMap): QuestionDef {
  if (q.type !== 'multi') return q;
  return { ...q, options: (q.options ?? []).filter((o) => !o.factKey || isOpen(facts[o.factKey])) };
}

/** Why a question is worth asking now, most important first. */
export type QuestionReason = 'safety' | 'clarify' | 'episode' | 'urgency' | 'required' | 'history' | 'detail' | 'closing';

export const QUESTION_REASON_TEXT: Record<QuestionReason, string> = {
  safety: 'Warning signs',
  clarify: 'You mentioned this; Nora wants to be sure',
  episode: 'Your earlier check',
  urgency: 'Could change how soon you should be seen',
  required: 'Needed to assess this properly',
  history: 'Your health background',
  detail: 'Helps describe your symptoms',
  closing: 'Anything else (optional)',
};

/** Source marking a fact the patient mentioned but hedged ("maybe a fever"), so Nora asks rather than assumes. */
export const UNCLEAR_SOURCE = 'unclear';

export interface PlannedQuestion {
  id: string;
  question: QuestionDef;
  reason: QuestionReason;
}

const LEVEL_WEIGHT: Record<UrgencyLevel, number> = { emergency: 1, urgent: 2, soon: 3, routine: 5, self_care: 9 };
const REQUIRED_WEIGHT = 4;
/** Hedged or contradicted mentions of a warning sign are cleared up straight after the warning-sign questions; others before routine questions. */
const CLARIFY_CRITICAL_WEIGHT = 0.25;
const CLARIFY_WEIGHT = 3.5;
const EPISODE_WEIGHT = 0.5;

/**
 * Open facts worth asking about, weighted by what their answer could change:
 * a rule or "get help if…" warning that could still fire above the current
 * urgency, then a concern's required facts. Nora doesn't ask questions to
 * guess at a cause, so a fact whose answer can no longer change the urgency
 * gets no weight and is not asked. Open facts that no remaining question asks
 * about are assumed to stay unconfirmed, so a rule that needs one of them
 * doesn't make its other facts worth asking.
 */
function factWeights(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[], askable: ReadonlySet<string>): Map<string, number> {
  const weights = new Map<string, number>();
  const bump = (key: string, w: number) => {
    if (isOpen(facts[key])) weights.set(key, Math.min(weights.get(key) ?? Number.POSITIVE_INFINITY, w));
  };
  const current = urgencyRank(evaluateUrgency(bundle, facts, concerns).level);
  const consider = (when: Condition, level: UrgencyLevel) => {
    if (urgencyRank(level) <= current || evaluatePartial(when, facts) !== undefined) return;
    const keys = conditionFacts(when);
    const unaskable = Object.fromEntries(keys.filter((k) => isOpen(facts[k]) && !askable.has(k)).map((k) => [k, { state: 'UNKNOWN' as const }]));
    if (evaluatePartial(when, { ...facts, ...unaskable }) === false) return;
    keys.forEach((k) => bump(k, LEVEL_WEIGHT[level]));
  };
  for (const r of applicableRules(bundle, concerns)) consider(r.when, r.level);
  for (const id of new Set(concerns.flatMap((c) => c.careItems))) bundle.careItems[id]?.escalate.forEach((e) => consider(e.when, e.level));
  [...concerns.flatMap((c) => c.requiredFacts), ...requiredTimings(bundle, facts)].forEach((k) => bump(k, REQUIRED_WEIGHT));
  for (const key of unclearFacts(facts)) bump(key, bundle.facts[key]?.critical ? CLARIFY_CRITICAL_WEIGHT : CLARIFY_WEIGHT);
  return weights;
}

/**
 * Facts about how this check relates to an earlier one. Only Nora's memory and
 * the patient's answer to the earlier-check question may set them; words like
 * "again" in free text are too ambiguous to decide it.
 */
export function episodeFacts(bundle: BundleContent): Set<string> {
  const q = bundle.episodeQuestion ? bundle.questions[bundle.episodeQuestion] : undefined;
  const keys = (q?.options ?? []).flatMap((o) => (o.factKey ? [o.factKey] : []));
  if (q?.askIf && 'fact' in q.askIf) keys.push(q.askIf.fact);
  return new Set(keys);
}

/** Facts the patient mentioned but hedged, still waiting for a clear answer. */
export function unclearFacts(facts: FactMap): string[] {
  return Object.entries(facts)
    .filter(([, f]) => f.source === UNCLEAR_SOURCE && isOpen(f))
    .map(([k]) => k);
}

function reasonFor(q: QuestionDef, weight: number, unclear: boolean): QuestionReason {
  if (q.purpose === 'safety') return 'safety';
  if (unclear) return 'clarify';
  if (q.purpose === 'history') return 'history';
  return weight === 0 || weight === REQUIRED_WEIGHT ? 'required' : 'urgency';
}

/**
 * Every question still worth asking, in the order Nora should ask them.
 * There is no question budget: the plan is empty only when the concern's
 * warning signs have been screened, its required facts are known, and no
 * open fact could still change the urgency.
 * Questions already answered, or whose facts the patient already told Nora
 * (in their own words or from their profile), are never planned.
 */
export function planQuestions(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[], asked: ReadonlySet<string>): PlannedQuestion[] {
  const screening = new Set(bundle.screeningQuestions);
  const unclear = unclearFacts(facts);
  const timings = requiredTimings(bundle, facts);
  const timingQuestions = Object.entries(bundle.questions).flatMap(([id, q]) => (q.factKey && timings.includes(q.factKey) ? [id] : []));
  const base = [
    ...bundle.screeningQuestions,
    ...(bundle.episodeQuestion ? [bundle.episodeQuestion] : []),
    ...concerns.flatMap((c) => c.questions),
    ...timingQuestions,
    ...completingQuestions(bundle, facts, concerns),
  ];
  const covered = new Set(base.flatMap((id) => (bundle.questions[id] ? questionFactKeys(bundle.questions[id]) : [])));
  const clarifying = unclear
    .filter((k) => !covered.has(k))
    .flatMap((k) => Object.entries(bundle.questions).find(([, q]) => q.purpose !== 'safety' && q.type !== 'text' && questionFactKeys(q).includes(k))?.[0] ?? []);
  const ordered = [...new Set([...base, ...clarifying])].filter((id) => id !== bundle.closingQuestion);
  const pending = new Set(
    ordered.filter((id) => {
      const q = bundle.questions[id];
      if (!q) return false;
      const reopened = questionFactKeys(q).some((k) => unclear.includes(k));
      return (!asked.has(id) || reopened) && !isResolved(q, facts) && (!q.askIf || evaluate(q.askIf, facts));
    }),
  );
  const askable = new Set([...pending].flatMap((id) => questionFactKeys(bundle.questions[id]!)));
  const weights = factWeights(bundle, facts, concerns, askable);
  const plan: (PlannedQuestion & { weight: number; index: number })[] = [];
  ordered.forEach((id, index) => {
    const q = bundle.questions[id];
    if (!q || !pending.has(id)) return;
    const open = questionFactKeys(q).filter((k) => isOpen(facts[k]));
    const weight =
      screening.has(id) || q.purpose === 'safety'
        ? 0
        : id === bundle.episodeQuestion
          ? EPISODE_WEIGHT
          : Math.min(...open.map((k) => weights.get(k) ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(weight)) return;
    const reason = id === bundle.episodeQuestion ? 'episode' : reasonFor(q, weight, open.some((k) => unclear.includes(k)));
    plan.push({ id, question: q, reason, weight, index });
  });
  const planned = plan.sort((a, b) => a.weight - b.weight || a.index - b.index).map(({ id, question, reason }) => ({ id, question, reason }));
  const closing = bundle.closingQuestion;
  if (closing && concerns.length > 0 && !asked.has(closing) && bundle.questions[closing]) {
    planned.push({ id: closing, question: bundle.questions[closing], reason: 'closing' });
  }
  return planned;
}

/**
 * Risk-factor questions that could complete a rule something the patient
 * reported has already partly met, such as a weakened immune system making a
 * reported fever urgent, even when no detected concern lists that question.
 * Only history facts are added, so Nora never goes looking for unrelated
 * symptoms; whether each is worth asking is still decided by how far its
 * answer could change urgency.
 */
function completingQuestions(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): string[] {
  const reported = (k: string) => facts[k]?.state === 'PRESENT' && facts[k]?.source !== 'profile' && bundle.facts[k]?.type === 'boolean';
  const open = new Set<string>();
  for (const r of applicableRules(bundle, concerns)) {
    const keys = conditionFacts(r.when);
    if (!keys.some(reported) || evaluatePartial(r.when, facts) !== undefined) continue;
    keys.filter((k) => isOpen(facts[k]) && bundle.facts[k]?.kind === 'history').forEach((k) => open.add(k));
  }
  return Object.entries(bundle.questions).flatMap(([id, q]) => (q.purpose !== 'safety' && q.type !== 'text' && questionFactKeys(q).some((k) => open.has(k)) ? [id] : []));
}

/** The most important question still worth asking, or null when the assessment is complete. */
export function nextQuestion(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[], asked: ReadonlySet<string>): PlannedQuestion | null {
  return planQuestions(bundle, facts, concerns, asked)[0] ?? null;
}

export function missingRequiredFacts(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[]): string[] {
  const keys = new Set([...concerns.flatMap((c) => c.requiredFacts), ...requiredTimings(bundle, facts)]);
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
