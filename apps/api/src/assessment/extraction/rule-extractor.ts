import type { BundleContent } from '../../clinical/bundle.schema.js';

export type Assertion = 'affirmed' | 'negated' | 'historical' | 'hypothetical' | 'uncertain' | 'family';

export interface Observation {
  factKey: string;
  state: 'PRESENT' | 'ABSENT';
  value?: number;
  quote: string;
  assertion: Assertion;
  source: 'rules' | 'llm';
}

const NEGATION = /\b(no|not|never|without|denies|deny|don't|dont|do not|doesn't|does not|haven't|have not|hasn't|isn't|aren't|wasn't|nor|neither|free of)\b/;
const HISTORICAL = /\b(last (year|month)|years ago|months ago|used to|in the past|history of|previously|as a child)\b/;
const HYPOTHETICAL = /\b(what if|if i|in case|worried (that )?i (might|could|will)|could i get|might get|afraid of getting)\b/;
const FAMILY = /\bmy (mother|mom|mum|father|dad|brother|sister|wife|husband|son|daughter|friend|grandmother|grandfather|child|kid|partner)\b/;
const UNCERTAIN = /\b(maybe|not sure|might have|possibly|i think i might|unsure)\b/;
const NEGATION_WINDOW_TOKENS = 5;

function clauses(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.;!?\n]+|[.;!?\n]/g;
  for (const m of text.matchAll(re)) {
    const parts = m[0].split(/(\b(?:but|however|although|except)\b)/);
    let offset = m.index;
    for (const part of parts) {
      if (part.trim() && !/^(but|however|although|except)$/.test(part)) out.push({ text: part, start: offset });
      offset += part.length;
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function classify(clause: string, matchIndex: number): Assertion {
  const before = clause.slice(0, matchIndex);
  const tokens = before.trim().split(/\s+/).slice(-NEGATION_WINDOW_TOKENS).join(' ');
  if (FAMILY.test(clause)) return 'family';
  if (HYPOTHETICAL.test(clause)) return 'hypothetical';
  if (HISTORICAL.test(clause)) return 'historical';
  if (NEGATION.test(tokens)) return 'negated';
  if (UNCERTAIN.test(before)) return 'uncertain';
  return 'affirmed';
}

function quoteFrom(original: string, start: number, length: number): string {
  return original.slice(start, start + length);
}

function durationDays(text: string): { value: number; index: number; length: number } | null {
  const lower = text.toLowerCase();
  const m = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|ten)\s*(hours?|hrs?|days?|weeks?|wks?|months?)\b/.exec(lower);
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
  if (m) {
    const n = words[m[1]!] ?? Number(m[1]);
    const unit = m[2]!;
    const days = unit.startsWith('h') ? Math.round((n / 24) * 10) / 10 : unit.startsWith('w') ? n * 7 : unit.startsWith('m') ? n * 30 : n;
    return { value: days, index: m.index, length: m[0].length };
  }
  const y = /\bsince (yesterday|last night)\b/.exec(lower);
  if (y) return { value: 1, index: y.index, length: y[0].length };
  const t = /\bsince (this morning|today)\b|\bstarted today\b/.exec(lower);
  if (t) return { value: 0, index: t.index, length: t[0].length };
  return null;
}

function temperatureC(text: string): { value: number; index: number; length: number } | null {
  const lower = text.toLowerCase();
  const explicit = /(\d{2,3}(?:\.\d{1,2})?)\s*(?:°\s*([cf])|degrees?\s*([cf])?\b|deg\s*([cf])?\b)/.exec(lower);
  const contextual = /\b(?:temp(?:erature)?|fever)\s*(?:of|is|was|at|around|about|:)?\s*(\d{2,3}(?:\.\d{1,2})?)/.exec(lower);
  const m = explicit ?? contextual;
  if (!m) return null;
  const raw = Number(m[1]);
  const unit = explicit ? (explicit[2] ?? explicit[3] ?? explicit[4]) : undefined;
  const isF = unit === 'f' || (!unit && raw >= 93);
  const c = isF ? Math.round((((raw - 32) * 5) / 9) * 10) / 10 : raw;
  if (c < 33 || c > 44) return null;
  return { value: c, index: m.index, length: m[0].length };
}

function age(text: string): { value: number; index: number; length: number } | null {
  const lower = text.toLowerCase();
  const m =
    /\b(\d{1,3})\s*(?:-|\s)?(?:years?|yrs?|yo|y\/o)(?:[\s-]*old)?\b/.exec(lower) ??
    /\bi(?:'m| am)\s+(\d{1,3})\b(?!\s*(?:days?|weeks?|hours?|°|degrees?|kg|cm))/.exec(lower) ??
    /\baged?\s*(\d{1,3})\b/.exec(lower);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 120 ? { value: v, index: m.index, length: m[0].length } : null;
}

function painScore(text: string): { value: number; index: number; length: number } | null {
  const m = /\b(\d{1,2})\s*(?:\/|out of)\s*10\b/.exec(text.toLowerCase());
  if (!m) return null;
  const v = Number(m[1]);
  return v <= 10 ? { value: v, index: m.index, length: m[0].length } : null;
}

/**
 * Deterministic synonym + negation extractor. Always runs (also alongside the
 * LLM) so emergency phrases are never missed because a model was unavailable
 * or wrong.
 */
export function extractWithRules(bundle: BundleContent, message: string): Observation[] {
  const lower = message.toLowerCase();
  const found = new Map<string, Observation>();

  for (const [factKey, def] of Object.entries(bundle.facts)) {
    if (def.type !== 'boolean') continue;
    const phrases = [...def.synonyms].sort((a, b) => b.length - a.length);
    for (const clause of clauses(lower)) {
      for (const phrase of phrases) {
        const re = new RegExp(`(^|[^a-z])${escape(phrase.toLowerCase())}(?![a-z])`);
        const m = re.exec(clause.text);
        if (!m) continue;
        const at = m.index + m[1]!.length;
        const assertion = classify(clause.text, at);
        const obs: Observation = {
          factKey,
          state: assertion === 'negated' ? 'ABSENT' : 'PRESENT',
          quote: quoteFrom(message, clause.start + at, phrase.length),
          assertion,
          source: 'rules',
        };
        const prev = found.get(factKey);
        if (!prev || (prev.assertion !== 'affirmed' && assertion === 'affirmed')) found.set(factKey, obs);
        break;
      }
    }
  }

  const numeric: [string, ReturnType<typeof age>][] = [
    ['age', age(message)],
    ['duration_days', durationDays(message)],
    ['temperature_c', temperatureC(message)],
    ['pain_score', painScore(message)],
  ];
  for (const [factKey, hit] of numeric) {
    if (!hit || !bundle.facts[factKey]) continue;
    found.set(factKey, { factKey, state: 'PRESENT', value: hit.value, quote: quoteFrom(message, hit.index, hit.length), assertion: 'affirmed', source: 'rules' });
  }

  const temp = found.get('temperature_c');
  if (temp?.value !== undefined && bundle.facts.fever && !found.has('fever')) {
    if (temp.value >= 38) found.set('fever', { ...temp, factKey: 'fever', value: undefined, state: 'PRESENT' });
    else if (temp.value < 37.5) found.set('fever', { ...temp, factKey: 'fever', value: undefined, state: 'ABSENT', assertion: 'negated' });
  }

  return [...found.values()].filter((o) => o.assertion === 'affirmed' || o.assertion === 'negated');
}
