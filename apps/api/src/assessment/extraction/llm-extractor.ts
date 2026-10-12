import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { BundleContent } from '../../clinical/bundle.schema.js';
import { type FactMap, UNCLEAR_SOURCE } from '../../clinical/rules-engine.js';
import { EXTRACTION_SYSTEM } from '../graph/prompts.js';
import type { AnswerConflict } from '../result.types.js';
import type { Observation } from './rule-extractor.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function usageOf(message: unknown): TokenUsage {
  const u = (message as { usage_metadata?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage_metadata;
  return { inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0 };
}

export function extractionSchema(bundle: BundleContent) {
  const keys = Object.keys(bundle.facts) as [string, ...string[]];
  return z.object({
    observations: z
      .array(
        z.object({
          factKey: z.enum(keys).describe('One of the allowed fact keys'),
          state: z.enum(['PRESENT', 'ABSENT']),
          value: z.number().nullable().describe('Numeric value for number facts (age in years, duration in days, temperature in °C, pain 0-10); otherwise null'),
          quote: z.string().describe('Exact, verbatim span from the patient message that supports this observation'),
          assertion: z.enum(['affirmed', 'negated', 'historical', 'hypothetical', 'uncertain', 'family']),
        }),
      )
      .max(40),
  });
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function numberRange(bundle: BundleContent, factKey: string): { min: number; max: number } {
  const question = Object.values(bundle.questions).find((q) => q.type === 'number' && q.factKey === factKey);
  return { min: question?.min ?? Number.NEGATIVE_INFINITY, max: question?.max ?? Number.POSITIVE_INFINITY };
}

/**
 * A model-reported number must be a number the patient actually wrote (or its
 * °F→°C conversion). Quotes without digits ("a week") are left to the range check.
 */
function numberGrounded(value: number, quote: string, unit: string | undefined): boolean {
  const written = (quote.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (written.length === 0) return true;
  return written.some((n) => Math.abs(n - value) < 0.05 || (unit === '°C' && Math.abs(((n - 32) * 5) / 9 - value) < 0.2));
}

/**
 * Drops anything the model could not ground in the patient's own words. A
 * warning sign can only be ruled out by a quote that names it, so the model
 * cannot skip a safety question on the patient's behalf.
 */
export function validateObservations(bundle: BundleContent, message: string, raw: z.infer<ReturnType<typeof extractionSchema>>['observations']): Observation[] {
  const haystack = normalise(message);
  const out: Observation[] = [];
  for (const o of raw) {
    const def = bundle.facts[o.factKey];
    if (!def || !o.quote.trim() || !haystack.includes(normalise(o.quote))) continue;
    const assertion = o.assertion === 'historical' && def.kind === 'history' ? 'affirmed' : o.assertion;
    if (assertion !== 'affirmed' && assertion !== 'negated') continue;
    const state = assertion === 'negated' ? 'ABSENT' : 'PRESENT';
    if (state === 'ABSENT' && def.critical && ![def.label, ...def.synonyms].some((t) => normalise(o.quote).includes(normalise(t)))) continue;
    if (def.type === 'number') {
      if (state !== 'PRESENT' || o.value === null || !Number.isFinite(o.value)) continue;
      const { min, max } = numberRange(bundle, o.factKey);
      if (o.value < min || o.value > max || !numberGrounded(o.value, o.quote, def.unit)) continue;
      out.push({ factKey: o.factKey, state, value: o.value, quote: o.quote, assertion, source: 'llm' });
    } else {
      out.push({ factKey: o.factKey, state, quote: o.quote, assertion, source: 'llm' });
    }
  }
  return out;
}

/** Yes/no facts the model saw mentioned with doubt, grounded in the patient's words like any other observation. */
export function validateHedged(bundle: BundleContent, message: string, raw: z.infer<ReturnType<typeof extractionSchema>>['observations']): { factKey: string; quote: string }[] {
  const haystack = normalise(message);
  return raw
    .filter((o) => o.assertion === 'uncertain' && bundle.facts[o.factKey]?.type === 'boolean' && o.quote.trim() && haystack.includes(normalise(o.quote)))
    .map(({ factKey, quote }) => ({ factKey, quote }));
}

export async function extractWithModel(
  model: BaseChatModel,
  bundle: BundleContent,
  message: string,
): Promise<{ observations: Observation[]; hedged: { factKey: string; quote: string }[]; usage: TokenUsage }> {
  const schema = extractionSchema(bundle);
  const catalogue = Object.entries(bundle.facts)
    .map(
      ([k, f]) =>
        `- ${k}: ${f.label}${f.unit ? ` (${f.unit})` : ''}${f.kind === 'history' ? ' [history]' : ''}${f.absentSynonyms.length ? ` (negated when the patient says: ${f.absentSynonyms.join(', ')})` : ''}`,
    )
    .join('\n');
  const runnable = model.withStructuredOutput(schema, { name: 'record_observations', includeRaw: true, method: 'functionCalling' });
  const { parsed, raw } = (await runnable.invoke([
    new SystemMessage(`${EXTRACTION_SYSTEM}\n\nAllowed fact keys:\n${catalogue}`),
    new HumanMessage(`<patient_message>\n${message}\n</patient_message>`),
  ])) as { parsed: z.infer<typeof schema>; raw: unknown };
  return {
    observations: validateObservations(bundle, message, parsed.observations),
    hedged: validateHedged(bundle, message, parsed.observations),
    usage: usageOf(raw),
  };
}

/**
 * Model observations take precedence for nuance, but a critical fact the
 * rules saw as PRESENT is never dropped or flipped by the model, and a number
 * the rules parsed deterministically is never replaced by the model's reading.
 */
export function mergeObservations(bundle: BundleContent, rules: Observation[], llm: Observation[]): Observation[] {
  const merged = new Map(llm.map((o) => [o.factKey, o]));
  for (const r of rules) {
    const existing = merged.get(r.factKey);
    if (!existing) merged.set(r.factKey, r);
    else if (bundle.facts[r.factKey]?.critical && r.state === 'PRESENT' && existing.state !== 'PRESENT') merged.set(r.factKey, r);
    else if (bundle.facts[r.factKey]?.type === 'number' && r.value !== undefined && r.value !== null) merged.set(r.factKey, r);
  }
  return [...merged.values()];
}

const CONFIRMED_SOURCES = new Set(['answer', 'profile', 'correction']);

/**
 * A yes/no the patient gave is never changed by reading a later message.
 * Disagreements are reported instead; the exceptions are a warning sign
 * they answered "no" to and later describe, and a condition or medicine their
 * profile doesn't list but their message mentions. Both are treated as present
 * to be safe and reported too.
 */
export function guardConfirmed(bundle: BundleContent, facts: FactMap, observations: Observation[]): { observations: Observation[]; conflicts: AnswerConflict[] } {
  const kept: Observation[] = [];
  const conflicts: AnswerConflict[] = [];
  for (const o of observations) {
    const current = facts[o.factKey];
    const def = bundle.facts[o.factKey];
    const answered = current && CONFIRMED_SOURCES.has(current.source ?? '') && (current.state === 'PRESENT' || current.state === 'ABSENT');
    if (!def || def.type !== 'boolean' || !answered || current.state === o.state) {
      kept.push(o);
      continue;
    }
    const fromProfile = current.source === 'profile';
    const safety = (def.critical || fromProfile) && o.state === 'PRESENT';
    conflicts.push({
      key: o.factKey,
      label: def.label,
      answered: current.state === 'PRESENT' ? 'yes' : 'no',
      mentioned: o.state === 'PRESENT' ? 'yes' : 'no',
      resolution: safety ? 'treated_as_present' : 'kept_answer',
      ...(fromProfile ? { answeredIn: 'profile' as const } : {}),
    });
    if (safety) kept.push(o);
  }
  return { observations: kept, conflicts };
}

/**
 * A hedged mention marks a fact as needing a question. It reopens an earlier
 * "no" so Nora asks again rather than ignoring the doubt, but never touches
 * something the patient said they have or were unsure about, or a clear
 * statement in the same message.
 */
export function applyHedged(facts: FactMap, hedged: { factKey: string }[], clear: Observation[]): FactMap {
  const stated = new Set(clear.map((o) => o.factKey));
  const changes: FactMap = {};
  for (const { factKey } of hedged) {
    const state = facts[factKey]?.state;
    if (stated.has(factKey) || state === 'PRESENT' || state === 'UNKNOWN' || state === 'DECLINED') continue;
    changes[factKey] = { state: 'NOT_ASKED', source: UNCLEAR_SOURCE };
  }
  return changes;
}

/** Returns only facts that change. Extraction never clears a critical PRESENT; that needs an explicit answer. */
export function applyObservations(bundle: BundleContent, facts: FactMap, observations: Observation[]): FactMap {
  const changes: FactMap = {};
  for (const o of observations) {
    const current = facts[o.factKey];
    if (current?.state === 'PRESENT' && o.state === 'ABSENT' && bundle.facts[o.factKey]?.critical) continue;
    if (current?.state === o.state && (current.value ?? null) === (o.value ?? null)) continue;
    changes[o.factKey] = { state: o.state, value: o.value ?? null, source: o.source };
  }
  return changes;
}
