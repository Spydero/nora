import type { BundleContent, ConcernDef, UrgencyLevel } from '../../clinical/bundle.schema.js';
import type { FactMap, TriggeredRule, UrgencyOutcome } from '../../clinical/rules-engine.js';
import type { FindingItem, Generator, ResultContent, ResultStatus } from '../result.types.js';
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

export function findings(bundle: BundleContent, facts: FactMap): ResultContent['findings'] {
  const out: ResultContent['findings'] = { present: [], absent: [], unknown: [] };
  for (const [key, f] of Object.entries(facts)) {
    const def = bundle.facts[key];
    if (!def || key === 'age') continue;
    const item: FindingItem = { key, label: def.label, source: f.source ?? 'unknown', ...(def.type === 'number' ? { value: f.value ?? null, unit: def.unit } : {}) };
    if (f.state === 'PRESENT') out.present.push(item);
    else if (f.state === 'ABSENT') out.absent.push(item);
    else if (f.state === 'UNKNOWN' || f.state === 'DECLINED') out.unknown.push(item);
  }
  return out;
}

export function caseSummary(bundle: BundleContent, facts: FactMap, concerns: string[], urgency: UrgencyOutcome | null, profile: string[]) {
  const f = findings(bundle, facts);
  const fmt = (i: FindingItem) => (i.value !== undefined && i.value !== null ? `${i.label}: ${i.value}${i.unit ? ` ${i.unit}` : ''}` : i.label);
  return {
    age: facts.age?.value ?? null,
    concerns: concernDefs(bundle, concerns).map((c) => ({ code: c.code, label: c.label })),
    present: f.present.map(fmt),
    absent: f.absent.map(fmt),
    unknown: f.unknown.map(fmt),
    urgency: urgency ? { level: urgency.level, reasons: urgency.triggered.map((t) => t.message), final: true } : null,
    profile,
  };
}

function cite(registry: EvidenceRegistry, sourceKeys: string[]): string[] {
  return [...new Set(sourceKeys.map((k) => registry.firstForSource(k)).filter((c): c is string => !!c))];
}

export function carePlan(bundle: BundleContent, level: UrgencyLevel, triggered: TriggeredRule[], concerns: ConcernDef[], registry: EvidenceRegistry): ResultContent['carePlan'] {
  const ids = [
    ...bundle.urgencyActions[level].careItems,
    ...triggered.flatMap((t) => t.careItems),
    ...(level === 'emergency' ? [] : concerns.flatMap((c) => c.careItems)),
  ];
  return [...new Set(ids)].map((id) => {
    const item = bundle.careItems[id]!;
    return { id, kind: item.kind, text: item.text, timeframe: item.timeframe, citations: cite(registry, [item.sourceKey]) };
  });
}

/** Deterministic draft from approved content; used without a model and as the verified fallback. */
export function templateDraft(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[], level: UrgencyLevel, registry: EvidenceRegistry, ranking?: Record<string, number>): Draft {
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
    .filter(([k, f]) => f.state === 'PRESENT' && bundle.facts[k]?.type === 'boolean')
    .map(([k]) => label(k));
  const days = facts.duration_days?.state === 'PRESENT' ? Number(facts.duration_days.value) : null;
  const duration = days === null ? '' : days < 1 ? ' since today' : ` for about ${days} ${days === 1 ? 'day' : 'days'}`;

  return {
    summary: `You described ${symptoms.length ? listText(symptoms) : 'your symptoms'}${duration}. Based on your answers and Nora's clinical rules, the recommended next step is: ${bundle.urgencyActions[level].title.toLowerCase()}. The possible explanations below are not a diagnosis — a clinician can confirm what is going on.`,
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
    questionsForClinician: [],
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
}

export function buildResult(a: BuildArgs): ResultContent {
  const action = a.bundle.urgencyActions[a.urgency.level];
  const byCode = new Map(a.concerns.flatMap((c) => c.explanations).map((e) => [e.code, e]));
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
      return e ? [{ code: e.code, label: e.label, plain: e.plain, clinical: e.clinical, likelihood: d.likelihood, rationale: d.rationale, citations: d.citations }] : [];
    }),
    carePlan: carePlan(a.bundle, a.urgency.level, a.urgency.triggered, a.concerns, a.registry),
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
  };
}

export function escalationResult(bundle: BundleContent, facts: FactMap, concerns: ConcernDef[], urgency: UrgencyOutcome, registry: EvidenceRegistry, emergency: EmergencyContacts): ResultContent {
  const reasons = urgency.triggered.filter((t) => t.level === 'emergency').map((t) => t.message);
  return buildResult({
    bundle,
    facts,
    concerns,
    urgency,
    registry,
    draft: { summary: `${reasons.join(' ')} Please get emergency help now — call ${emergency.number}.`, explanations: [], questionsForClinician: [] },
    status: 'ESCALATED',
    generator: 'rules',
    model: null,
    missing: [],
    limitations: ['Nora stopped the assessment because your answers include emergency warning signs.'],
    emergency,
    verification: { passed: true, attempts: 0, issues: [] },
  });
}

export function unsupportedResult(bundle: BundleContent, facts: FactMap, urgency: UrgencyOutcome, message: string, registry: EvidenceRegistry, emergency: EmergencyContacts): ResultContent {
  const level: UrgencyLevel = urgency.level === 'self_care' ? 'routine' : urgency.level;
  return buildResult({
    bundle,
    facts,
    concerns: [],
    urgency: { ...urgency, level },
    registry,
    draft: { summary: message, explanations: [], questionsForClinician: [] },
    status: 'UNSUPPORTED',
    generator: 'rules',
    model: null,
    missing: [],
    limitations: [message],
    emergency,
    verification: { passed: true, attempts: 0, issues: [] },
  });
}
