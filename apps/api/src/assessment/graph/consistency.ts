import { type BundleContent, type UrgencyLevel, urgencyRank } from '../../clinical/bundle.schema.js';
import type { FactMap } from '../../clinical/rules-engine.js';
import type { ResultContent } from '../result.types.js';

/** Wording that implies the problem needs nothing more than time or home care. */
export const SELF_RESOLVING = [
  /\b(settles?|settling|clears?|goes away|go away|gets? better|resolves?|improves?)\s+(up\s+)?(on (its|their) own|by (itself|themselves)|without (any )?treatment)\b/i,
  /\b(manage|managed|treat|treated|look after)\s+(this|it|them|your symptoms|yourself)\s+at home\b/i,
  /\bself[- ]care at home\b/i,
  /\bhome (care|remedies|treatment) (is|are|should be|will be) (enough|sufficient|all you need)\b/i,
  /\bwait and see\b/i,
];

/** Next-step wording that belongs to a lower level than the one the rules set. */
const BELOW_SOON = [
  /\bif (it|this|they|symptoms|your symptoms) (do(es)?n['’]?t|do(es)? not) (improve|get better|settle)\b/i,
  /\bif (you are |you're )?not improving\b/i,
  /\broutine appointment\b/i,
  /\bno rush\b/i,
  /\bwhen(ever)? (it is |it's )?convenient\b/i,
];
const BELOW_URGENT = [/\bwithin (the next )?(24|48|24\s?[–-]\s?48) hours\b/i, /\bin the next (few|couple of) days\b/i, /\bthis week\b/i];

/** Issues for text that recommends less than the rules require. */
export function urgencyIssues(texts: string[], level: UrgencyLevel): string[] {
  const issues: string[] = [];
  const rank = urgencyRank(level);
  const lower = [...(rank >= urgencyRank('soon') ? [...BELOW_SOON, ...SELF_RESOLVING] : []), ...(rank >= urgencyRank('urgent') ? BELOW_URGENT : [])];
  for (const t of texts) {
    if (lower.some((re) => re.test(t))) issues.push(`Suggests less care than your warning signs need: "${t.slice(0, 80)}"`);
  }
  return issues;
}

/** Next-step wording that belongs to a higher level than the one the rules set. */
const EMERGENCY_WORDING = [
  /\b(call|phone|dial|ring)\s+(112|108|911|999|an ambulance|emergency services)\b/i,
  /\bgo (straight )?to (the |your nearest )?(emergency (department|room)|a&e|er|casualty)\b/i,
  /\b(this is|this could be|this may be|it is|it's) (a |an )?(medical )?emergency\b/i,
];
const SAME_DAY_WORDING = [
  /\b(see|seek|get|contact|visit|speak (to|with)|go to)\b[^.]{0,40}\b(today|same[- ]day|immediately|right away|straight away|urgently|as soon as possible)\b/i,
  /\bneeds? (urgent|same[- ]day|immediate|emergency) (care|attention|treatment|assessment)\b/i,
];
/** "If …" or "should … get worse" sentences describe what to do if things change, not the advice now. */
const CONDITIONAL = /\b(if|unless|should (it|this|they|you|symptoms|your symptoms)|in case|whenever|any time)\b/i;

/** Issues for text that recommends more than the rules set, so two parts of the result would disagree. */
export function aboveLevelIssues(texts: string[], level: UrgencyLevel): string[] {
  const issues: string[] = [];
  const rank = urgencyRank(level);
  const stronger = [...(rank < urgencyRank('emergency') ? EMERGENCY_WORDING : []), ...(rank < urgencyRank('urgent') ? SAME_DAY_WORDING : [])];
  for (const t of texts) {
    for (const s of t.split(/(?<=[.!?;])\s+/)) {
      if (!CONDITIONAL.test(s) && stronger.some((re) => re.test(s))) issues.push(`Suggests more urgent care than Nora’s safety rules set: "${s.slice(0, 80)}"`);
    }
  }
  return issues;
}

/**
 * The last check before a result is shown: the summary, general information and
 * care plan must all agree with the urgency the rules set. "Get help if…"
 * warnings and comfort measures while waiting are conditional, so only their
 * stronger wording is allowed.
 */
export function recommendationConflicts(result: Pick<ResultContent, 'urgency' | 'summary' | 'information' | 'carePlan'>): string[] {
  const level = result.urgency.level;
  const steps = result.carePlan.filter((c) => !c.watch && !c.whileWaiting).map((c) => c.text);
  const statements = [result.summary, ...(result.information ?? []).map((i) => i.text), ...steps];
  return [...new Set([...urgencyIssues([result.summary, ...steps], level), ...aboveLevelIssues(statements, level)])];
}

const NEGATION = /\b(no|not|never|without|denies|denied|none|neither|nor|free of|absence of|don['’]?t|doesn['’]?t|didn['’]?t|haven['’]?t|hasn['’]?t|isn['’]?t|aren['’]?t)\b/i;
/** Words that can sit between a negation and the symptom it denies ("don't have a fever", "no signs of cough"). */
const DENIAL_FILLER = "(?:a|an|any|the|your|have|has|had|got|having|report|reported|mention|mentioned|feel|experience|experiencing|signs?|of|real|obvious|significant|current|new|ongoing|other)";
const ASSERT = /\byou(?:['’]ve| have| had| are having| reported| mentioned| described| said you have| told nora (?:you have|about))\b/gi;
const CONDITIONAL_BEFORE = /\b(if|unless|whether|when|should|in case)\s+$/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface AnswerFacts {
  present: { label: string; terms: string[] }[];
  absent: { label: string; terms: string[] }[];
  numbers: { label: string; value: number; unit: string }[];
  /** Symptoms the patient hasn't confirmed in this check (not mentioned, not sure or skipped). */
  unreported?: { label: string; terms: string[] }[];
}

const termsOf = (label: string, synonyms: string[]) => {
  const simpleLabel = /^[\w\s-]+$/.test(label) && label.split(/\s+/).length <= 3 ? [label] : [];
  return [...new Set([...synonyms, ...simpleLabel].map((t) => t.toLowerCase()))];
};

/**
 * What the patient told Nora in this check, with the words they may be
 * described by. Facts derived from memory are not the patient's answers, and
 * symptoms from earlier checks count as unreported until the patient confirms
 * them again.
 */
export function answerFacts(bundle: BundleContent, facts: FactMap): AnswerFacts {
  const out: AnswerFacts = { present: [], absent: [], numbers: [], unreported: [] };
  for (const [key, def] of Object.entries(bundle.facts)) {
    const f = facts[key];
    if (key === 'age' || def.kind === 'context') continue;
    if (!f || f.source === 'memory' || f.state === 'NOT_ASKED' || f.state === 'UNKNOWN' || f.state === 'DECLINED') {
      if ((def.kind === 'symptom' || def.kind === 'exposure') && def.type === 'boolean') out.unreported!.push({ label: def.label, terms: termsOf(def.label, def.synonyms) });
      continue;
    }
    if (def.type === 'number') {
      if (f.state === 'PRESENT' && typeof f.value === 'number' && def.unit) out.numbers.push({ label: def.label, value: f.value, unit: def.unit });
      continue;
    }
    const terms = termsOf(def.label, def.synonyms);
    if (terms.length === 0) continue;
    if (f.state === 'PRESENT') out.present.push({ label: def.label, terms });
    else if (f.state === 'ABSENT') out.absent.push({ label: def.label, terms });
  }
  const confirmed = out.present.flatMap((p) => p.terms);
  out.unreported = out.unreported!
    .map((u) => ({ ...u, terms: u.terms.filter((t) => !confirmed.some((c) => c.includes(t) || t.includes(c))) }))
    .filter((u) => u.terms.length);
  return out;
}

const UNIT_PATTERN: Record<string, string> = { '°C': '(?:\\s?°\\s?C\\b|\\s?degrees)', days: '\\s?days?\\b' };
const BOUND_AFTER = /^\s*(or (more|higher|longer|above|over|less|lower)|\+|and (above|over))/i;
const BOUND_BEFORE = /\b(above|over|below|under|at least|more than|less than|longer than|up to|within|after|next)\s*$/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/);
}

/** Where a "you have …" claim ends: the list after it may continue with commas, but not into another clause. */
const CLAIM_END = /\b(but|which|that|so|because|if|unless|when|although|though|while|whereas|and (?:this|it|these|that|you|nora|a doctor))\b|[;:()]/i;
/** Sentences about earlier checks or records rather than this consultation. */
const PAST_CONTEXT = /\b(before|previous(ly)?|earlier|last (time|week|month|year)|ago|used to|in the past|history of|past check|records?|M\d+)\b/i;

/**
 * A draft may not deny something the patient said they have, claim something
 * they said they don't have, or restate one of their numbers differently.
 */
export function answerIssues(texts: string[], answers: AnswerFacts): string[] {
  const issues = new Set<string>();
  for (const text of texts) {
    for (const s of sentences(text)) {
      for (const fact of answers.present) {
        for (const term of fact.terms) {
          const re = new RegExp(`${NEGATION.source}\\s+(?:${DENIAL_FILLER}\\s+){0,3}${escape(term)}\\b`, 'i');
          if (re.test(s)) issues.add(`Says you don't have "${fact.label}", but you said you do: "${s.slice(0, 80)}"`);
        }
      }
      for (const fact of answers.absent) {
        for (const m of s.matchAll(ASSERT)) {
          if (CONDITIONAL_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
          const rest = s.slice(m.index + m[0].length);
          for (const term of fact.terms) {
            const at = rest.search(new RegExp(`\\b${escape(term)}\\b`, 'i'));
            if (at >= 0 && !NEGATION.test(rest.slice(0, at))) issues.add(`Says you have "${fact.label}", but you said you don't: "${s.slice(0, 80)}"`);
          }
        }
      }
      if (!PAST_CONTEXT.test(s)) {
        for (const m of s.matchAll(ASSERT)) {
          if (CONDITIONAL_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
          const rest = s.slice(m.index + m[0].length);
          const end = rest.search(CLAIM_END);
          const claim = end >= 0 ? rest.slice(0, end) : rest;
          for (const fact of answers.unreported ?? []) {
            for (const term of fact.terms) {
              const at = claim.search(new RegExp(`\\b${escape(term)}\\b`, 'i'));
              if (at >= 0 && !NEGATION.test(claim.slice(0, at))) issues.add(`Says you have "${fact.label}", which you haven't told Nora about in this check: "${s.slice(0, 80)}"`);
            }
          }
        }
      }
      for (const unitName of new Set(answers.numbers.map((n) => n.unit))) {
        const unit = UNIT_PATTERN[unitName];
        if (!unit) continue;
        const same = answers.numbers.filter((n) => n.unit === unitName);
        for (const m of s.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`, 'gi'))) {
          if (BOUND_BEFORE.test(s.slice(0, m.index)) || BOUND_AFTER.test(s.slice(m.index + m[0].length))) continue;
          if (same.some((n) => Math.abs(Number(m[1]) - n.value) <= 0.05)) continue;
          const told = same.map((n) => `"${n.label}" was ${n.value} ${n.unit}`).join(' and ');
          issues.add(`States ${m[0].trim()}, but your answer for ${told}.`);
        }
      }
    }
  }
  return [...issues];
}
