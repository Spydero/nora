import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { BundleContent } from '../../clinical/bundle.schema.js';
import type { FactMap } from '../../clinical/rules-engine.js';
import { EXTRACTION_SYSTEM } from '../graph/prompts.js';
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

/** Drops anything the model could not ground in the patient's own words. */
export function validateObservations(bundle: BundleContent, message: string, raw: z.infer<ReturnType<typeof extractionSchema>>['observations']): Observation[] {
  const haystack = normalise(message);
  const out: Observation[] = [];
  for (const o of raw) {
    const def = bundle.facts[o.factKey];
    if (!def || !o.quote.trim() || !haystack.includes(normalise(o.quote))) continue;
    if (o.assertion !== 'affirmed' && o.assertion !== 'negated') continue;
    const state = o.assertion === 'negated' ? 'ABSENT' : 'PRESENT';
    if (def.type === 'number') {
      if (state !== 'PRESENT' || o.value === null || !Number.isFinite(o.value)) continue;
      out.push({ factKey: o.factKey, state, value: o.value, quote: o.quote, assertion: o.assertion, source: 'llm' });
    } else {
      out.push({ factKey: o.factKey, state, quote: o.quote, assertion: o.assertion, source: 'llm' });
    }
  }
  return out;
}

export async function extractWithModel(
  model: BaseChatModel,
  bundle: BundleContent,
  message: string,
): Promise<{ observations: Observation[]; usage: TokenUsage }> {
  const schema = extractionSchema(bundle);
  const catalogue = Object.entries(bundle.facts)
    .map(([k, f]) => `- ${k}: ${f.label}${f.unit ? ` (${f.unit})` : ''}`)
    .join('\n');
  const runnable = model.withStructuredOutput(schema, { name: 'record_observations', includeRaw: true, method: 'functionCalling' });
  const { parsed, raw } = (await runnable.invoke([
    new SystemMessage(`${EXTRACTION_SYSTEM}\n\nAllowed fact keys:\n${catalogue}`),
    new HumanMessage(`<patient_message>\n${message}\n</patient_message>`),
  ])) as { parsed: z.infer<typeof schema>; raw: unknown };
  return { observations: validateObservations(bundle, message, parsed.observations), usage: usageOf(raw) };
}

/**
 * Model observations take precedence for nuance, but a critical fact the
 * rules saw as PRESENT is never dropped or flipped by the model.
 */
export function mergeObservations(bundle: BundleContent, rules: Observation[], llm: Observation[]): Observation[] {
  const merged = new Map(llm.map((o) => [o.factKey, o]));
  for (const r of rules) {
    const existing = merged.get(r.factKey);
    if (!existing) merged.set(r.factKey, r);
    else if (bundle.facts[r.factKey]?.critical && r.state === 'PRESENT' && existing.state !== 'PRESENT') merged.set(r.factKey, r);
  }
  return [...merged.values()];
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
