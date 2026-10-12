import type { BundleContent } from '../../clinical/bundle.schema.js';

export type Assertion = 'affirmed' | 'negated' | 'historical' | 'hypothetical' | 'uncertain' | 'family';

export interface Observation {
  factKey: string;
  state: 'PRESENT' | 'ABSENT';
  value?: number;
  quote: string;
  /** The part of the message the quote sits in, so severity and timing in the patient's words are kept with the fact. */
  said?: string;
  assertion: Assertion;
  source: 'rules' | 'llm';
}

const NEGATION = /\b(no|not|never|without|denies|deny|don't|dont|do not|doesn't|does not|haven't|have not|hasn't|isn't|aren't|wasn't|nor|neither|free of)\b/;
const HISTORICAL = /\b(last (year|month)|years ago|months ago|used to|in the past|history of|previously|as a child)\b/;
const HYPOTHETICAL = /\b(what if|if i|in case|worried (that )?i (might|could|will)|could i get|might get|afraid of getting)\b/;
const FAMILY = /\bmy (mother|mom|mum|father|dad|brother|sister|wife|husband|son|daughter|friend|grandmother|grandfather|child|kid|partner)\b/;
const UNCERTAIN = /\b(maybe|not sure|might have|possibly|perhaps|i think i might|unsure|not certain|don't know if|dont know if)\b/;
const UNSURE_NEAR = /\b(not sure|unsure|don't know|dont know|not certain)\b/;
const NEGATION_WINDOW_TOKENS = 5;
const UNSURE_WINDOW_TOKENS = 8;

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

/**
 * Doubt that only loosely attaches to a symptom ("could be a fever", "a fever,
 * not sure"). It never softens a warning sign, which stays affirmed so a
 * possible emergency is never downgraded to a question.
 */
const SOFT_DOUBT_BEFORE = /\b(could be|might be|may be|possibly|probably)\b/;
const SOFT_DOUBT_AFTER = /^(\W*\w+){0,3}?\W*\b(not sure|unsure|not certain)\W*$/;

function classify(clause: string, matchIndex: number, matchLength = 0, critical = false): Assertion {
  const assertion = classifyStrict(clause, matchIndex);
  if (assertion !== 'affirmed' || critical) return assertion;
  const before = clause.slice(0, matchIndex).trim().split(/\s+/).slice(-UNSURE_WINDOW_TOKENS).join(' ');
  const after = clause.slice(matchIndex + matchLength).split(/\s+/).slice(0, 6).join(' ');
  return SOFT_DOUBT_BEFORE.test(before) || SOFT_DOUBT_AFTER.test(after) ? 'uncertain' : assertion;
}

function classifyStrict(clause: string, matchIndex: number): Assertion {
  const before = clause.slice(0, matchIndex);
  const tokens = before.trim().split(/\s+/).slice(-NEGATION_WINDOW_TOKENS).join(' ');
  if (FAMILY.test(clause)) return 'family';
  if (UNSURE_NEAR.test(before.trim().split(/\s+/).slice(-UNSURE_WINDOW_TOKENS).join(' '))) return 'uncertain';
  if (HYPOTHETICAL.test(clause)) return 'hypothetical';
  if (HISTORICAL.test(clause)) return 'historical';
  if (NEGATION.test(tokens)) return 'negated';
  if (UNCERTAIN.test(before)) return 'uncertain';
  return 'affirmed';
}

function quoteFrom(original: string, start: number, length: number): string {
  return original.slice(start, start + length);
}

/**
 * Parts of a message that each carry their own timeline: "a dog bit me 3 days
 * ago, and the fever started yesterday" has an exposure and an onset.
 * `commas` also splits at commas, which is right for timing but too fine for
 * keeping a symptom's description ("a really bad, throbbing headache").
 */
function segments(text: string, commas: boolean): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const m of text.matchAll(commas ? /[^.;!?\n,]+/g : /[^.;!?\n]+/g)) {
    const parts = m[0].split(/(\b(?:and|but|however|although|then|after|before|whereas|while)\b)/);
    let offset = m.index;
    for (const part of parts) {
      if (part.trim() && !/^(and|but|however|although|then|after|before|whereas|while)$/.test(part)) out.push({ text: part, start: offset });
      offset += part.length;
    }
  }
  return out;
}

const SAID_MAX = 160;

/** The patient's words around a match, trimmed to the part that describes it. */
export function saidAround(original: string, index: number): string | undefined {
  const seg = segments(original.toLowerCase(), false).find((s) => index >= s.start && index < s.start + s.text.length);
  if (!seg) return undefined;
  const text = original.slice(seg.start, seg.start + seg.text.length).trim();
  return text.length > SAID_MAX ? `${text.slice(0, SAID_MAX - 1).trimEnd()}…` : text;
}

/** The segment of the message containing a verbatim quote, for checking what a model-read number refers to. */
export function segmentOf(message: string, quote: string): string | undefined {
  const lower = message.toLowerCase();
  const at = lower.indexOf(quote.toLowerCase().trim());
  if (at < 0) return undefined;
  return segments(lower, true).find((s) => at >= s.start && at < s.start + s.text.length)?.text;
}

interface TimeHit {
  value: number;
  index: number;
  length: number;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 'couple of': 2, few: 3,
};
const SPAN = /\b(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few)\s*(hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?)\b/g;
const AGE_AFTER = /^[\s-]*old\b/;
const AGE_BEFORE = /\b(i am|i'm|aged?)\s*$/;

/** Every stretch of time written in a piece of text, in days. */
function timeSpans(text: string, offset: number): TimeHit[] {
  const hits: TimeHit[] = [];
  for (const m of text.matchAll(SPAN)) {
    if (AGE_AFTER.test(text.slice(m.index + m[0].length)) || AGE_BEFORE.test(text.slice(0, m.index))) continue;
    const n = NUMBER_WORDS[m[1]!] ?? Number(m[1]);
    const unit = m[2]!;
    const days = unit.startsWith('h') ? Math.round((n / 24) * 10) / 10 : unit.startsWith('w') ? n * 7 : unit.startsWith('m') ? n * 30 : unit.startsWith('y') ? n * 365 : n;
    hits.push({ value: days, index: offset + m.index, length: m[0].length });
  }
  const relative: [RegExp, number][] = [
    [/\b(yesterday|last night)\b/, 1],
    [/\b(this morning|today|tonight|this evening)\b/, 0],
    [/\blast week\b/, 7],
  ];
  for (const [re, value] of relative) {
    const m = re.exec(text);
    if (m) hits.push({ value, index: offset + m.index, length: m[0].length });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Words that tie a time to an event the patient was exposed to rather than to when symptoms began. */
const EXPOSURE_CONTEXT =
  /\b(bit|bitten|bite|bites|biting|scratched|stung|ate|eaten|eating|drank|drinking|travell?ed|travell?ing|trip|visited|came back|returned|got back|exposed|swam|swimming|stepped on|contact with|in contact)\b/;
/** Words that tie a time to the symptoms themselves. */
const ONSET_CONTEXT = /\b(for|since|started|starting|starts|began|begun|ago|past|lasting|lasted|been|now|over the)\b/;

const synonymsOf = (bundle: BundleContent, kind: string) =>
  Object.values(bundle.facts)
    .filter((f) => f.kind === kind && f.type === 'boolean')
    .flatMap((f) => f.synonyms);

/**
 * What a piece of text with a time in it is about. Times next to a long-term
 * condition or in the past ("asthma for 10 years", "years ago") are history;
 * times next to a bite, a meal or a trip are the exposure's own timeline; the
 * rest describe how long symptoms have lasted, but only when the text names a
 * symptom or reads like an onset ("for 3 days", "started yesterday").
 */
export function timeRole(bundle: BundleContent, text: string): 'history' | 'exposure' | 'onset' | null {
  const lower = text.toLowerCase();
  const has = (phrases: string[]) => phrases.some((p) => phrasePattern(p).test(lower));
  if (HISTORICAL.test(lower) || has(synonymsOf(bundle, 'history'))) return 'history';
  if (EXPOSURE_CONTEXT.test(lower) || has(synonymsOf(bundle, 'exposure'))) return 'exposure';
  if (ONSET_CONTEXT.test(lower) || has(synonymsOf(bundle, 'symptom'))) return 'onset';
  return null;
}

/**
 * How long symptoms have lasted and how long ago an exposure happened, kept
 * apart. When the message gives different durations for different symptoms
 * ("cough for 2 weeks, fever for 3 days") the longest is used, because every
 * duration rule asks whether symptoms have lasted at least so long; each
 * symptom keeps its own timing in the patient's words.
 */
function timeline(bundle: BundleContent, message: string): { onset: TimeHit | null; exposure: TimeHit | null } {
  const lower = message.toLowerCase();
  let onset: TimeHit | null = null;
  let exposure: TimeHit | null = null;
  for (const seg of segments(lower, true)) {
    const spans = timeSpans(seg.text, seg.start);
    if (!spans.length) continue;
    const role = timeRole(bundle, seg.text);
    if (role === 'exposure') exposure ??= spans[0]!;
    else if (role === 'onset') for (const s of spans) if (!onset || s.value > onset.value) onset = s;
  }
  return { onset, exposure };
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

/** Multi-word phrases tolerate one extra word between their words ("swollen neck glands", "runny or blocked nose"). */
function phrasePattern(phrase: string): RegExp {
  const words = phrase.toLowerCase().split(/\s+/).map(escape);
  return new RegExp(`(^|[^a-z])${words.join(String.raw`\s+(?:[a-z'-]+\s+)?`)}(?![a-z])`);
}

/**
 * Deterministic synonym + negation extractor. Always runs (also alongside the
 * LLM) so emergency phrases are never missed because a model was unavailable
 * or wrong.
 */
function scan(bundle: BundleContent, message: string): Observation[] {
  const lower = message.toLowerCase();
  const found = new Map<string, Observation>();

  for (const [factKey, def] of Object.entries(bundle.facts)) {
    if (def.type !== 'boolean') continue;
    const phrases = [...def.synonyms].sort((a, b) => b.length - a.length);
    for (const clause of clauses(lower)) {
      for (const phrase of phrases) {
        const m = phrasePattern(phrase).exec(clause.text);
        if (!m) continue;
        const at = m.index + m[1]!.length;
        const classified = classify(clause.text, at, m[0].length - m[1]!.length, def.critical);
        const assertion = classified === 'historical' && def.kind === 'history' ? 'affirmed' : classified;
        const said = saidAround(message, clause.start + at);
        const obs: Observation = {
          factKey,
          state: assertion === 'negated' ? 'ABSENT' : 'PRESENT',
          quote: quoteFrom(message, clause.start + at, m[0].length - m[1]!.length),
          ...(said ? { said } : {}),
          assertion,
          source: 'rules',
        };
        const prev = found.get(factKey);
        if (!prev || (prev.assertion !== 'affirmed' && assertion === 'affirmed')) found.set(factKey, obs);
        break;
      }
    }
    if (found.has(factKey)) continue;
    for (const clause of clauses(lower)) {
      const hit = def.absentSynonyms
        .map((phrase) => phrasePattern(phrase).exec(clause.text))
        .find((m): m is RegExpExecArray => m !== null && classify(clause.text, m.index + m[1]!.length) === 'affirmed');
      if (!hit) continue;
      const at = hit.index + hit[1]!.length;
      found.set(factKey, { factKey, state: 'ABSENT', quote: quoteFrom(message, clause.start + at, hit[0].length - hit[1]!.length), assertion: 'negated', source: 'rules' });
      break;
    }
  }

  const times = timeline(bundle, message);
  const numeric: [string, ReturnType<typeof age>][] = [
    ['age', age(message)],
    ['duration_days', times.onset],
    ['exposure_days', times.exposure],
    ['temperature_c', temperatureC(message)],
    ['pain_score', painScore(message)],
  ];
  for (const [factKey, hit] of numeric) {
    if (!hit || !bundle.facts[factKey]) continue;
    const said = saidAround(message, hit.index);
    found.set(factKey, {
      factKey,
      state: 'PRESENT',
      value: hit.value,
      quote: quoteFrom(message, hit.index, hit.length),
      ...(said ? { said } : {}),
      assertion: 'affirmed',
      source: 'rules',
    });
  }

  const temp = found.get('temperature_c');
  if (temp?.value !== undefined && bundle.facts.fever && !found.has('fever')) {
    if (temp.value >= 38) found.set('fever', { ...temp, factKey: 'fever', value: undefined, state: 'PRESENT' });
    else if (temp.value < 37.5) found.set('fever', { ...temp, factKey: 'fever', value: undefined, state: 'ABSENT', assertion: 'negated' });
  }

  return [...found.values()];
}

export function extractWithRules(bundle: BundleContent, message: string): Observation[] {
  return scan(bundle, message).filter((o) => o.assertion === 'affirmed' || o.assertion === 'negated');
}

/** Symptoms the patient mentioned but hedged ("maybe a fever"); Nora asks about them rather than assuming either way. */
export function hedgedMentions(bundle: BundleContent, message: string): { factKey: string; quote: string }[] {
  return scan(bundle, message)
    .filter((o) => o.assertion === 'uncertain' && bundle.facts[o.factKey]?.type === 'boolean')
    .map(({ factKey, quote }) => ({ factKey, quote }));
}
