import { type BundleContent, type UrgencyLevel, urgencyRank } from '../../clinical/bundle.schema.js';
import type { FactMap } from '../../clinical/rules-engine.js';

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
}

/**
 * What the patient told Nora in this check, with the words they may be
 * described by. Facts derived from memory are not the patient's answers.
 */
export function answerFacts(bundle: BundleContent, facts: FactMap): AnswerFacts {
  const out: AnswerFacts = { present: [], absent: [], numbers: [] };
  for (const [key, f] of Object.entries(facts)) {
    const def = bundle.facts[key];
    if (!def || f.source === 'memory' || key === 'age') continue;
    if (def.type === 'number') {
      if (f.state === 'PRESENT' && typeof f.value === 'number' && def.unit) out.numbers.push({ label: def.label, value: f.value, unit: def.unit });
      continue;
    }
    const simpleLabel = /^[\w\s-]+$/.test(def.label) && def.label.split(/\s+/).length <= 3 ? [def.label] : [];
    const terms = [...new Set([...def.synonyms, ...simpleLabel].map((t) => t.toLowerCase()))];
    if (terms.length === 0) continue;
    if (f.state === 'PRESENT') out.present.push({ label: def.label, terms });
    else if (f.state === 'ABSENT') out.absent.push({ label: def.label, terms });
  }
  return out;
}

const UNIT_PATTERN: Record<string, string> = { '°C': '(?:\\s?°\\s?C\\b|\\s?degrees)', days: '\\s?days?\\b' };
const BOUND_AFTER = /^\s*(or (more|higher|longer|above|over|less|lower)|\+|and (above|over))/i;
const BOUND_BEFORE = /\b(above|over|below|under|at least|more than|less than|longer than|up to|within|after|next)\s*$/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/);
}

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
      for (const n of answers.numbers) {
        const unit = UNIT_PATTERN[n.unit];
        if (!unit) continue;
        for (const m of s.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`, 'gi'))) {
          if (BOUND_BEFORE.test(s.slice(0, m.index)) || BOUND_AFTER.test(s.slice(m.index + m[0].length))) continue;
          if (Math.abs(Number(m[1]) - n.value) > 0.05) issues.add(`States ${m[0].trim()}, but your answer for "${n.label}" was ${n.value} ${n.unit}.`);
        }
      }
    }
  }
  return [...issues];
}
