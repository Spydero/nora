import type { BundleContent } from '../clinical/bundle.schema.js';
import type { FactMap } from '../clinical/rules-engine.js';

/** A profile list as stored: "known" and "none" are complete answers; "unknown" and "declined" are not. */
export interface ProfileList {
  state?: string;
  items?: string[];
}

const COMPLETE = new Set(['known', 'none']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a profile entry such as "Mild asthma" or "Warfarin 5 mg" names this history fact. */
export function namesFact(entry: string, terms: string[]): boolean {
  const text = entry.toLowerCase();
  return terms.some((t) => new RegExp(`(^|[^a-z])${escape(t.toLowerCase())}(?![a-z])`).test(text));
}

/**
 * History facts from the patient's profile, kept apart from the symptoms of
 * any one consultation. A condition or medicine the profile lists is present.
 * When both lists are complete (the patient said what they have, or that they
 * have none) anything not listed is absent, so Nora doesn't ask again; when
 * either list is unknown or declined, unlisted facts stay open and Nora asks
 * only if the answer could change the advice.
 */
export function historyFacts(bundle: BundleContent, conditions: ProfileList | null, medications: ProfileList | null): FactMap {
  const entries = [...(conditions?.state === 'known' ? (conditions.items ?? []) : []), ...(medications?.state === 'known' ? (medications.items ?? []) : [])];
  const complete = COMPLETE.has(conditions?.state ?? '') && COMPLETE.has(medications?.state ?? '');
  const facts: FactMap = {};
  for (const [key, def] of Object.entries(bundle.facts)) {
    if (def.kind !== 'history' || def.type !== 'boolean') continue;
    const terms = [...def.synonyms, def.label];
    if (entries.some((e) => namesFact(e, terms))) facts[key] = { state: 'PRESENT', source: 'profile' };
    else if (complete) facts[key] = { state: 'ABSENT', source: 'profile' };
  }
  return facts;
}
