import { type BundleContent, type ConcernDef, type UrgencyLevel, maxUrgency, urgencyRank } from '../../clinical/bundle.schema.js';
import { type FactMap, quantity, type TriggeredRule, type UrgencyOutcome, warningLevel } from '../../clinical/rules-engine.js';
import { type MemoryItem, memoryLine } from '../../memory/memory.types.js';
import type { AnswerConflict, FindingItem, Generator, ResultContent, ResultStatus } from '../result.types.js';
import { SELF_RESOLVING } from './consistency.js';
import type { EvidenceRegistry } from './evidence-registry.js';
import type { Draft } from './verify.js';

export interface EmergencyContacts {
  number: string;
  crisisLine: { name: string; number: string } | null;
}

/** Labels such as "swollen, tender neck glands" contain commas, so they go last where they still read clearly. */
export function listText(items: string[]): string {
  if (items.length < 2) return items.join('');
  const ordered = [...items.filter((i) => !i.includes(',')), ...items.filter((i) => i.includes(','))];
  const sep = ordered.filter((i) => i.includes(',')).length > 1 ? '; ' : ', ';
  return `${ordered.slice(0, -1).join(sep)} and ${ordered.at(-1)}`;
}

export function concernDefs(bundle: BundleContent, codes: string[]): ConcernDef[] {
  return bundle.concerns.filter((c) => codes.includes(c.code));
}

/**
 * Findings are what the patient told Nora in this check, as present, absent
 * or unknown. Long-term history (from the answers or the profile) is kept
 * apart from the consultation's symptoms; facts derived from memory and
 * context such as age are not findings.
 */
export function findings(bundle: BundleContent, facts: FactMap): ResultContent['findings'] {
  const out: ResultContent['findings'] = { present: [], absent: [], unknown: [] };
  const history: NonNullable<ResultContent['findings']['history']> = { present: [], absent: [], unknown: [] };
  for (const [key, f] of Object.entries(facts)) {
    const def = bundle.facts[key];
    if (!def || def.kind === 'context' || key === 'age' || f.source === 'memory') continue;
    const item: FindingItem = { key, label: def.label, source: f.source ?? 'unknown', ...(def.type === 'number' ? { value: f.value ?? null, unit: def.unit } : {}) };
    const into = def.kind === 'history' ? history : out;
    if (f.state === 'PRESENT') into.present.push(item);
    else if (f.state === 'ABSENT') into.absent.push(item);
    else if (f.state === 'UNKNOWN' || f.state === 'DECLINED') into.unknown.push(item);
  }
  return history.present.length || history.absent.length || history.unknown.length ? { ...out, history } : out;
}

/**
 * Records that belong in this consultation: the patient's profile and
 * appointments, plus earlier checks for the same problem or the check this
 * one follows up. Unrelated earlier checks are left out so their symptoms
 * can't leak into a new assessment.
 */
export function relevantMemory(memory: MemoryItem[], concerns: string[], parentCheckId?: string | null): MemoryItem[] {
  return memory.filter((m) => m.kind !== 'past_check' || (!!parentCheckId && m.checkId === parentCheckId) || (!!m.concernCode && concerns.includes(m.concernCode)));
}

export function caseSummary(bundle: BundleContent, facts: FactMap, concerns: string[], urgency: UrgencyOutcome | null, memory: MemoryItem[]) {
  const f = findings(bundle, facts);
  const fmt = (i: FindingItem) => (i.value !== undefined && i.value !== null ? `${i.label}: ${quantity(i.value, i.unit)}` : i.label);
  return {
    age: facts.age?.value ?? null,
    concerns: concernDefs(bundle, concerns).map((c) => ({ code: c.code, label: c.label })),
    thisConsultation: { present: f.present.map(fmt), absent: f.absent.map(fmt), unknown: f.unknown.map(fmt) },
    healthBackground: { present: (f.history?.present ?? []).map(fmt), absent: (f.history?.absent ?? []).map(fmt) },
    urgency: urgency ? { level: urgency.level, reasons: urgency.triggered.map((t) => t.message), final: true } : null,
    records: memory.map(memoryLine),
  };
}

/** A finished check for one of the current concerns within the bundle's recurrence window. */
export function recurrence(bundle: BundleContent, concerns: string[], memory: MemoryItem[], now: Date): MemoryItem | null {
  const since = now.getTime() - bundle.meta.recurrenceDays * 86_400_000;
  return memory.find((m) => m.kind === 'past_check' && !!m.concernCode && concerns.includes(m.concernCode) && Date.parse(m.recordedAt ?? '') >= since) ?? null;
}

/**
 * Questions a patient should raise, built only from their confirmed records,
 * so they need no model and cannot invent history.
 */
export function recordQuestions(memory: MemoryItem[]): { questions: string[]; refs: string[] } {
  const picked = [...memory.filter((m) => m.kind === 'allergy').slice(0, 2), ...memory.filter((m) => m.kind === 'medicine').slice(0, 2)];
  return {
    questions: picked.map((m) =>
      m.kind === 'allergy' ? `Is any treatment you suggest safe with my ${m.text} allergy?` : `Could this, or anything you prescribe for it, interact with my ${m.text}?`,
    ),
    refs: picked.map((m) => m.id),
  };
}

function cite(registry: EvidenceRegistry, sourceKeys: string[]): string[] {
  return [...new Set(sourceKeys.map((k) => registry.firstForSource(k)).filter((c): c is string => !!c))];
}

/**
 * The plan never pairs a warning with home care as if it were enough:
 * - from "see a doctor today" upwards, home care is left out;
 * - at "within 24–48 hours" it is only offered as comfort until the patient is seen;
 * - a "get help if…" warning that has already happened is a reason in the
 *   urgency, not something to watch for, and one that asks for no more than
 *   the current level adds nothing.
 */
export function carePlan(
  bundle: BundleContent,
  level: UrgencyLevel,
  triggered: TriggeredRule[],
  concerns: ConcernDef[],
  registry: EvidenceRegistry,
  facts: FactMap,
): ResultContent['carePlan'] {
  const ids = [
    ...bundle.urgencyActions[level].careItems,
    ...triggered.flatMap((t) => t.careItems),
    ...(level === 'emergency' ? [] : concerns.flatMap((c) => c.careItems)),
  ];
  return [...new Set(ids)].flatMap((id) => {
    const item = bundle.careItems[id]!;
    if (item.kind === 'self_care' && urgencyRank(level) >= urgencyRank('urgent')) return [];
    const watch = item.escalate.length > 0;
    if (watch) {
      const highest = item.escalate.reduce<UrgencyLevel>((acc, e) => maxUrgency(acc, e.level), 'self_care');
      if (warningLevel(bundle, id, facts) || urgencyRank(highest) <= urgencyRank(level)) return [];
    }
    return [
      {
        id,
        kind: item.kind,
        text: item.text,
        timeframe: item.timeframe,
        citations: cite(registry, [item.sourceKey]),
        watch,
        ...(item.kind === 'self_care' && level === 'soon' ? { whileWaiting: true } : {}),
      },
    ];
  });
}

/** Deterministic draft from approved content; used without a model and as the verified fallback. */
export function templateDraft(
  bundle: BundleContent,
  facts: FactMap,
  concerns: ConcernDef[],
  registry: EvidenceRegistry,
  ranking?: Record<string, number>,
  memory: MemoryItem[] = [],
): Draft {
  const fromRecords = recordQuestions(memory);
  const present = (k: string) => facts[k]?.state === 'PRESENT';
  const label = (k: string) => bundle.facts[k]?.label.toLowerCase() ?? k;
  const candidates = concerns.flatMap((c) => c.explanations);
  const scored = candidates
    .map((e) => {
      const support = e.supportingFacts.filter(present);
      const against = e.againstFacts.filter(present);
      const score = ranking?.[e.code] ?? support.length - against.length;
      return { e, support, against, score };
    })
    .sort((a, b) => b.score - a.score);

  const likelihood = (score: number, i: number): Draft['explanations'][number]['likelihood'] => {
    if (ranking) return score >= 0.5 ? 'more_likely' : score >= 0.15 ? 'possible' : 'less_likely';
    return i === 0 && score > 0 ? 'more_likely' : score < 0 ? 'less_likely' : 'possible';
  };

  const symptoms = Object.entries(facts)
    .filter(([k, f]) => f.state === 'PRESENT' && bundle.facts[k]?.type === 'boolean' && bundle.facts[k]?.kind === 'symptom')
    .map(([k]) => label(k));
  const days = facts.duration_days?.state === 'PRESENT' ? Number(facts.duration_days.value) : null;
  const duration = days === null ? '' : days < 1 ? ' since today' : ` for about ${days} ${days === 1 ? 'day' : 'days'}`;

  return {
    summary: `You described ${symptoms.length ? listText(symptoms) : 'your symptoms'}${duration}.`,
    explanations: scored.map(({ e, support, against, score }, i) => ({
      code: e.code,
      likelihood: likelihood(score, i),
      rationale: [
        support.length ? `Fits with: ${listText(support.map(label))}.` : 'No specific features point strongly towards this.',
        against.length ? `Less consistent with: ${listText(against.map(label))}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      citations: cite(registry, e.sourceKeys),
    })),
    questionsForClinician: fromRecords.questions,
    memoryRefs: fromRecords.refs,
  };
}

interface BuildArgs {
  bundle: BundleContent;
  facts: FactMap;
  concerns: ConcernDef[];
  urgency: UrgencyOutcome;
  registry: EvidenceRegistry;
  draft: Draft;
  status: ResultStatus;
  generator: Generator;
  model: string | null;
  missing: string[];
  limitations: string[];
  emergency: EmergencyContacts;
  verification: ResultContent['verification'];
  memory: MemoryItem[];
  answerConflicts?: AnswerConflict[];
}

const WARNING_CAUTION = 'Your answers include warning signs, so don’t wait for this to settle on its own. Follow the advice above.';

export function buildResult(a: BuildArgs): ResultContent {
  const action = a.bundle.urgencyActions[a.urgency.level];
  const byCode = new Map(a.concerns.flatMap((c) => c.explanations).map((e) => [e.code, e]));
  const warned = urgencyRank(a.urgency.level) >= urgencyRank('soon');
  const handoffFrames: Record<UrgencyLevel, string> = { emergency: 'Now', urgent: 'Today', soon: 'Within 24–48 hours', routine: 'Within 1–2 weeks if not improving', self_care: 'If symptoms continue or worsen' };
  return {
    schemaVersion: '1',
    status: a.status,
    urgency: {
      level: a.urgency.level,
      title: action.title,
      text: action.text,
      reasons: a.urgency.triggered.map((t) => ({ ruleId: t.ruleId, message: t.message, citations: cite(a.registry, [t.sourceKey]) })),
    },
    summary: a.draft.summary,
    concerns: a.concerns.map((c) => ({ code: c.code, label: c.label })),
    findings: findings(a.bundle, a.facts),
    explanations: a.draft.explanations.flatMap((d) => {
      const e = byCode.get(d.code);
      if (!e) return [];
      const caution = warned && SELF_RESOLVING.some((re) => re.test(e.plain)) ? { caution: WARNING_CAUTION } : {};
      return [{ code: e.code, label: e.label, plain: e.plain, clinical: e.clinical, likelihood: d.likelihood, rationale: d.rationale, citations: d.citations, ...caution }];
    }),
    carePlan: carePlan(a.bundle, a.urgency.level, a.urgency.triggered, a.concerns, a.registry, a.facts),
    questionsForClinician: a.draft.questionsForClinician,
    missingInformation: a.missing.map((key) => ({ key, label: a.bundle.facts[key]?.label ?? key })),
    limitations: a.limitations,
    handoff: {
      recommended: a.urgency.level !== 'self_care',
      specialty: a.urgency.level === 'emergency' ? 'Emergency Medicine' : (a.concerns[0]?.specialty ?? 'General Physician'),
      timeframe: handoffFrames[a.urgency.level],
    },
    evidence: a.registry.list(),
    disclaimer: a.bundle.meta.disclaimer,
    emergency: a.emergency,
    generator: a.generator,
    model: a.model,
    verification: a.verification,
    memory: a.memory.map(({ id, kind, label, text, href, checkId }) => ({ id, kind, label, text, href, ...(checkId ? { checkId } : {}), used: a.draft.memoryRefs.includes(id) })),
    ...(a.answerConflicts?.length ? { answerConflicts: a.answerConflicts } : {}),
  };
}

export function escalationResult(
  bundle: BundleContent,
  facts: FactMap,
  concerns: ConcernDef[],
  urgency: UrgencyOutcome,
  registry: EvidenceRegistry,
  emergency: EmergencyContacts,
  memory: MemoryItem[] = [],
  answerConflicts: AnswerConflict[] = [],
): ResultContent {
  const f = findings(bundle, facts);
  const labels = (items: FindingItem[]) => items.filter((x) => bundle.facts[x.key]?.type === 'boolean').map((x) => x.label.toLowerCase());
  const told = labels(f.present);
  const background = labels(f.history?.present ?? []);
  return buildResult({
    bundle,
    facts,
    concerns,
    urgency,
    registry,
    memory,
    answerConflicts,
    draft: {
      summary: [
        told.length ? `You told Nora about ${listText(told)}.` : '',
        background.length ? `Your health profile lists ${listText(background)}.` : '',
        'Nora stopped asking questions so you can get help straight away.',
      ]
        .filter(Boolean)
        .join(' '),
      explanations: [],
      questionsForClinician: [],
      memoryRefs: [],
    },
    status: 'ESCALATED',
    generator: 'rules',
    model: null,
    missing: [],
    limitations: [],
    emergency,
    verification: { passed: true, attempts: 0, issues: [] },
  });
}

export function unsupportedResult(
  bundle: BundleContent,
  facts: FactMap,
  urgency: UrgencyOutcome,
  message: string,
  registry: EvidenceRegistry,
  emergency: EmergencyContacts,
  memory: MemoryItem[] = [],
  answerConflicts: AnswerConflict[] = [],
): ResultContent {
  const level: UrgencyLevel = urgency.level === 'self_care' ? 'routine' : urgency.level;
  return buildResult({
    bundle,
    facts,
    concerns: [],
    urgency: { ...urgency, level },
    registry,
    memory,
    answerConflicts,
    draft: { summary: message, explanations: [], questionsForClinician: [], memoryRefs: [] },
    status: 'UNSUPPORTED',
    generator: 'rules',
    model: null,
    missing: [],
    limitations: [message],
    emergency,
    verification: { passed: true, attempts: 0, issues: [] },
  });
}
