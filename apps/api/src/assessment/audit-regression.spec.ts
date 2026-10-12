import { AIMessage } from '@langchain/core/messages';
import { ScriptedDecisions } from '../ai/decisions.js';
import { ScriptedChatModel } from '../ai/scripted-chat-model.js';
import { demoBundle } from '../clinical/content/demo-bundle.js';
import { demoKnowledge } from '../clinical/content/knowledge.js';
import { detectConcerns, evaluateUrgency, type FactMap, missingRequiredFacts, planQuestions, runSentinels } from '../clinical/rules-engine.js';
import { InMemoryKnowledge } from '../knowledge/in-memory-knowledge.js';
import type { MemoryItem } from '../memory/memory.types.js';
import { applyObservations, guardConfirmed, validateObservations } from './extraction/llm-extractor.js';
import { extractWithRules } from './extraction/rule-extractor.js';
import { type AssessmentDeps, type AssessmentInput, runAssessment } from './graph/assessment-graph.js';
import { findings, recurrence, relevantMemory } from './graph/compose.js';
import { bestPassage, claimOverlap, supports } from './graph/evidence-registry.js';
import { CONDITION } from './graph/verify.js';
import { buildDoctorSummary } from '../checks/doctor-summary.js';
import { type UrgencyLevel, urgencyRank } from '../clinical/bundle.schema.js';

const contacts = { number: '112', crisisLine: null };
const adult: FactMap = { age: { state: 'PRESENT', value: 30, source: 'profile' } };
const P = (value?: number) => ({ state: 'PRESENT' as const, value: value ?? null, source: 'answer' });
const A = { state: 'ABSENT' as const, source: 'answer' };
const U = { state: 'UNKNOWN' as const, source: 'answer' };
const ALL_ASKED = Object.keys(demoBundle.questions);

const read = (text: string, facts: FactMap = adult): FactMap => ({ ...facts, ...applyObservations(demoBundle, facts, extractWithRules(demoBundle, text)) });
const value = (facts: FactMap, key: string) => (facts[key]?.state === 'PRESENT' ? facts[key]!.value : undefined);

function deps(mode: 'off' | 'failing' | 'hostile'): AssessmentDeps {
  const knowledge = new InMemoryKnowledge(demoKnowledge);
  if (mode === 'off') return { models: null, decisions: null, knowledge, maxResearchRounds: 2 };
  const unsafe = { summary: 'You have strep throat and there is no need to see a doctor. Take 500 mg amoxicillin.', questionsForClinician: ['Is this more likely viral?'], memoryRefs: [] };
  const chat =
    mode === 'failing'
      ? new ScriptedChatModel([new Error('503 overloaded')], [new Error('503 overloaded'), new Error('503 overloaded')])
      : new ScriptedChatModel([new AIMessage('ok')], [unsafe, unsafe]);
  const decisions = new ScriptedDecisions([mode === 'failing' ? new Error('timeout') : { needs_emergency_care: { type: 'noul', noul: 0.01 } }]);
  return { models: { chat, fast: new ScriptedChatModel([], [new Error('503')]), chatName: 'scripted', fastName: 'scripted' }, decisions, knowledge, maxResearchRounds: 2 };
}

const input = (facts: FactMap, message?: string, asked = ALL_ASKED): AssessmentInput => ({
  bundle: demoBundle,
  context: { patientMessage: message ? { id: 'm1', text: message } : null, memory: [], emergency: contacts },
  facts: { ...adult, ...facts },
  asked,
  turnCount: 1,
});

describe('symptom, exposure and timeline preservation', () => {
  it('keeps a bite’s date apart from when the symptoms started', () => {
    const facts = read('A stray dog bit my hand 5 days ago and I have had a fever since yesterday');
    expect(facts.animal_bite?.state).toBe('PRESENT');
    expect(facts.fever?.state).toBe('PRESENT');
    expect(value(facts, 'animal_bite_days')).toBe(5);
    expect(value(facts, 'duration_days')).toBe(1);
  });

  it('does not take how long someone has had a condition as how long the symptoms have lasted', () => {
    const facts = read('I have had diabetes for 10 years and a cough for 3 days');
    expect(value(facts, 'duration_days')).toBe(3);
    expect(facts.diabetes?.state).toBe('PRESENT');
  });

  it('records a bite on its own without inventing a symptom duration', () => {
    const facts = read('I was bitten by a dog 2 weeks ago');
    expect(value(facts, 'animal_bite_days')).toBe(14);
    expect(facts.duration_days).toBeUndefined();
  });

  it('drops a model reading that takes an exposure date as the symptom duration', () => {
    const message = 'A dog bit me 5 days ago and I have a fever since yesterday';
    const kept = validateObservations(demoBundle, message, [
      { factKey: 'duration_days', state: 'PRESENT', value: 5, quote: 'bit me 5 days ago', assertion: 'affirmed' },
      { factKey: 'animal_bite_days', state: 'PRESENT', value: 5, quote: 'bit me 5 days ago', assertion: 'affirmed' },
    ]);
    expect(kept.map((o) => o.factKey)).toEqual(['animal_bite_days']);
  });

  it('drops a model reading that gives one exposure’s date to another', () => {
    const message = 'A dog bit me 5 days ago. I ate street food yesterday';
    const kept = validateObservations(demoBundle, message, [
      { factKey: 'animal_bite_days', state: 'PRESENT', value: 1, quote: 'I ate street food yesterday', assertion: 'affirmed' },
      { factKey: 'animal_bite_days', state: 'PRESENT', value: 5, quote: 'A dog bit me 5 days ago', assertion: 'affirmed' },
    ]);
    expect(kept.map((o) => o.value)).toEqual([5]);
  });

  it('keeps each exposure’s own time when a message names two', () => {
    const facts = read('A dog bit me 5 days ago. I also ate street food 2 days ago and now I have diarrhoea since yesterday');
    expect(facts.animal_bite?.state).toBe('PRESENT');
    expect(facts.suspect_food?.state).toBe('PRESENT');
    expect(value(facts, 'animal_bite_days')).toBe(5);
    expect(value(facts, 'suspect_food_days')).toBe(2);
    expect(value(facts, 'duration_days')).toBe(1);
    const f = findings(demoBundle, facts);
    expect(f.exposures!.map((i) => [i.key, i.daysAgo])).toEqual(expect.arrayContaining([['animal_bite', 5], ['suspect_food', 2]]));
  });

  it('carries each exposure’s own time through triage, the result and the doctor summary', async () => {
    const message = 'A dog bit me 5 days ago. I also ate street food 2 days ago and I have had diarrhoea since yesterday';
    const out = await runAssessment(deps('off'), input({ bite_bleeding: A, snake_bite: A, breathless_severe: A, lip_throat_swelling: A }, message));
    const r = out.result!;
    expect(out.facts.animal_bite_days).toMatchObject({ value: 5 });
    expect(out.facts.suspect_food_days).toMatchObject({ value: 2 });
    expect(out.facts.duration_days).toMatchObject({ value: 1 });
    expect(r.urgency.reasons.map((x) => x.ruleId)).toContain('r_animal_bite');
    expect(r.findings.exposures!.map((i) => [i.key, i.daysAgo])).toEqual(expect.arrayContaining([['animal_bite', 5], ['suspect_food', 2]]));
    for (const key of ['animal_bite_days', 'suspect_food_days']) expect(r.findings.present.map((i) => i.key)).not.toContain(key);
    expect(r.summary).toMatch(/bitten or scratched by an animal \(about 5 days ago\)/i);
    expect(r.summary).toMatch(/unsafe \(about 2 days ago\)/i);
    const summary = buildDoctorSummary({
      checkId: 'c1',
      createdAt: new Date(),
      assessedAt: new Date(),
      patient: { name: null, age: 30, sexAtBirth: null },
      profile: null,
      ownWords: [message],
      answers: [],
      additional: [],
      result: r,
      review: null,
      urgencyTitles: {},
      now: new Date(),
    });
    const exposures = summary.sections.find((s) => s.id === 'exposures')!.text;
    expect(exposures).toMatch(/Bitten or scratched by an animal — 5 days ago/);
    expect(exposures).toMatch(/may have been unsafe — 2 days ago/);
  });

  it('keeps a time it can’t tie to one exposure as a general exposure time, not as either exposure’s or the symptoms’', () => {
    const facts = read('A dog bit me and I ate street food. It happened 3 days ago');
    expect(value(facts, 'animal_bite_days')).toBeUndefined();
    expect(value(facts, 'suspect_food_days')).toBeUndefined();
    expect(value(facts, 'exposure_days')).toBe(3);
    expect(facts.duration_days).toBeUndefined();
  });

  it('reads "it was … ago" as the time of whatever the sentence before described', () => {
    const bite = read('A dog bit my hand. It was 5 days ago');
    expect(value(bite, 'animal_bite_days')).toBe(5);
    expect(bite.duration_days).toBeUndefined();
    const fever = read('I have a fever. It started 2 days ago');
    expect(value(fever, 'duration_days')).toBe(2);
  });

  it('keeps symptoms, denials, severity and the patient’s own words, and invents nothing', () => {
    const message = 'Severe headache for 2 days, pain 8/10, no fever and no stiff neck';
    const f = findings(demoBundle, read(message));
    expect(f.present.map((i) => i.key).sort()).toEqual(['duration_days', 'headache', 'pain_score']);
    expect(f.present.find((i) => i.key === 'headache')!.said).toMatch(/Severe headache/);
    expect(f.present.find((i) => i.key === 'pain_score')!.value).toBe(8);
    expect(f.absent.map((i) => i.key).sort()).toEqual(['fever', 'stiff_neck']);
  });

  it('lists exposures separately from symptoms', () => {
    const f = findings(demoBundle, read('A dog bit me 3 days ago and now I have a fever'));
    expect(f.exposures!.map((i) => [i.key, i.daysAgo])).toEqual([['animal_bite', 3]]);
    expect(f.present.map((i) => i.key)).not.toContain('animal_bite');
    expect(f.present.map((i) => i.key)).toContain('fever');
  });
});

describe('adaptive questioning', () => {
  const plan = (facts: FactMap, asked: string[] = []) => planQuestions(demoBundle, facts, detectConcerns(demoBundle, facts), new Set(asked)).map((p) => p.id);

  it('screens a bite’s warning signs first and asks when it happened only if the patient did not say', () => {
    const told = read('A dog bit me 3 days ago');
    expect(plan(told)[0]).toBe('q_ws_bite');
    expect(plan(told)).not.toContain('q_animal_bite_days');
    expect(plan(read('A dog bit my leg'))).toContain('q_animal_bite_days');
  });

  it('asks when each significant exposure happened, and nothing about exposures the patient didn’t report', () => {
    const facts: FactMap = { ...adult, animal_bite: P(), suspect_food: P(), diarrhoea: P() };
    const ids = plan(facts);
    expect(ids).toContain('q_animal_bite_days');
    expect(ids).not.toContain('q_snake_bite_days');
    expect(plan({ ...adult, diarrhoea: P(), suspect_food: P() })).not.toContain('q_animal_bite_days');
  });

  it('counts an unknown time for a significant exposure as missing information', () => {
    const facts: FactMap = { ...adult, animal_bite: P(), bite_bleeding: A, snake_bite: A, breathless_severe: A, lip_throat_swelling: A };
    expect(missingRequiredFacts(demoBundle, facts, detectConcerns(demoBundle, facts))).toContain('animal_bite_days');
    expect(missingRequiredFacts(demoBundle, { ...facts, animal_bite_days: P(2) }, detectConcerns(demoBundle, facts))).not.toContain('animal_bite_days');
  });

  it('follows both the bite and a new fever, without asking anything twice', () => {
    const facts = read('A dog bit me 10 days ago and I have had a fever since yesterday');
    expect(detectConcerns(demoBundle, facts).map((c) => c.code)).toEqual(expect.arrayContaining(['fever', 'animal_bite']));
    const ids = plan(facts);
    expect(ids).toContain('q_ws_bite');
    expect(ids).toContain('q_ws_fever');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never plans a question the patient already answered, even across concerns', () => {
    const facts = { ...read('Cough and fever for 3 days'), breathless: A };
    const first = plan(facts);
    const asked = first.slice(0, 3);
    const next = plan(facts, asked);
    for (const id of asked) expect(next).not.toContain(id);
  });

  it('asks again about a symptom when a later message contradicts the answer', () => {
    const facts: FactMap = { ...adult, sore_throat: P(), cough: A };
    const guarded = guardConfirmed(demoBundle, facts, extractWithRules(demoBundle, 'actually I do have a cough'));
    expect(guarded.conflicts[0]).toMatchObject({ key: 'cough', resolution: 'ask_again' });
    expect(plan({ ...facts, ...guarded.reopen }, ['q_cough'])).toContain('q_cough');
  });
});

describe('high-risk exposures reach the right pathway', () => {
  it('sends an animal bite to same-day care with wound washing first', async () => {
    const out = await runAssessment(deps('off'), input({ bite_bleeding: A, snake_bite: A, breathless_severe: A, lip_throat_swelling: A }, 'A stray dog bit my hand 3 days ago'));
    const r = out.result!;
    expect(r.urgency.level).toBe('urgent');
    expect(r.urgency.reasons.map((x) => x.ruleId)).toContain('r_animal_bite');
    expect(r.carePlan.map((c) => c.id)).toContain('ci_bite_wash');
    expect(r.information!.map((i) => i.code)).toContain('info_rabies');
    expect(r.findings.exposures!.map((i) => i.key)).toContain('animal_bite');
  });

  it('treats a snake bite as an emergency straight away', async () => {
    const out = await runAssessment(deps('off'), input({}, 'I was bitten by a snake on my foot', []));
    expect(out.outcome).toBe('ESCALATED');
    expect(out.result!.urgency.level).toBe('emergency');
  });

  it('treats a bite that will not stop bleeding as an emergency', () => {
    const facts: FactMap = { ...adult, animal_bite: P(), bite_bleeding: P() };
    expect(evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts)).level).toBe('emergency');
  });

  it('passes every clinical sentinel, including the bite scenarios', () => {
    const { results } = runSentinels(demoBundle);
    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(['s_dog_bite', 's_snake_bite', 's_bite_bleeding']));
  });
});

describe('urgency for fever in older adults, headache with vision changes or a rash, and hearing loss', () => {
  const outcome = (facts: FactMap) => {
    const all = { ...adult, ...facts };
    return evaluateUrgency(demoBundle, all, detectConcerns(demoBundle, all));
  };
  const level = (facts: FactMap) => outcome(facts).level;
  const rank = (facts: FactMap) => urgencyRank(level(facts));
  const old = { age: P(70) };

  it('never gives an older adult with a fever less urgent advice than a younger one, whatever the main symptom', () => {
    const combos: FactMap[] = [
      { fever: P() },
      { fever: P(), body_aches: P() },
      { fever: P(), headache: P() },
      { fever: P(), cough: P() },
      { fever: P(), sore_throat: P() },
      { fever: P(), diarrhoea: P() },
      { fever: P(), runny_nose: P() },
    ];
    for (const c of combos) expect(rank({ ...c, ...old }), JSON.stringify(c)).toBeGreaterThanOrEqual(rank(c));
    for (const c of combos) expect(rank({ ...c, ...old }), JSON.stringify(c)).toBeGreaterThanOrEqual(urgencyRank('soon'));
  });

  it('sends an older adult with a fever and flu-like symptoms to a doctor the same day, in any concern', () => {
    for (const symptom of ['body_aches', 'headache', 'cough']) {
      const o = outcome({ ...old, fever: P(), [symptom]: P() });
      expect(o.level, symptom).toBe('urgent');
      expect(o.triggered.map((t) => t.ruleId), symptom).toContain('r_flu_higher_risk');
    }
    expect(outcome({ fever: P(), body_aches: P() }).triggered.map((t) => t.ruleId)).not.toContain('r_flu_higher_risk');
  });

  it('treats a headache with vision problems as same-day, and loss of vision or bright light bothering them as an emergency', () => {
    expect(level({ headache: P(), vision_change: P() })).toBe('urgent');
    expect(level({ headache: P(), fever: P(), vision_change: P() })).not.toMatch(/self_care|routine|soon/);
    expect(level({ headache: P(), vision_loss: P() })).toBe('emergency');
    expect(level({ headache: P(), light_sensitivity: P() })).toBe('emergency');
  });

  it('keeps an ordinary rash with a headache from becoming an emergency, but not a rash that doesn’t fade or comes with a fever', () => {
    const plain = outcome({ headache: P(), rash: P(), fever: A, nonblanching_rash: A });
    expect(plain.level).not.toBe('emergency');
    expect(plain.triggered.map((t) => t.ruleId)).not.toContain('warn:ci_headache_monitor');
    expect(level({ headache: P(), rash: P(), nonblanching_rash: P() })).toBe('emergency');
    expect(level({ headache: P(), rash: P(), fever: P() })).not.toMatch(/self_care|routine|soon/);
  });

  it('treats a change in hearing with earache, or sudden hearing loss with any symptom, as same-day', () => {
    expect(level({ ear_pain: P(), hearing_loss: P() })).toBe('urgent');
    expect(level({ dizziness: P(), hearing_loss: P(), hearing_loss_sudden: P() })).toBe('urgent');
    expect(level({ headache: P(), hearing_loss: P(), hearing_loss_sudden: P() })).toBe('urgent');
    expect(outcome({ dizziness: P(), hearing_loss: P(), hearing_loss_sudden: A }).triggered.map((t) => t.ruleId)).toContain('r_hearing_gradual');
    const plan = planQuestions(demoBundle, { ...adult, dizziness: P(), hearing_loss: P() }, detectConcerns(demoBundle, { dizziness: P() }), new Set());
    expect(plan.map((p) => p.id)).toContain('q_hearing_sudden');
  });
});

describe('unknown answers', () => {
  it('never treats "not sure" about a bite warning sign as a no', async () => {
    const out = await runAssessment(deps('off'), input({ animal_bite: P(), animal_bite_days: P(2), bite_bleeding: U, snake_bite: A, breathless_severe: A, lip_throat_swelling: A }));
    const r = out.result!;
    expect(r.triage!.missingSafety.map((m) => m.key)).toContain('bite_bleeding');
    expect(r.urgency.reasons.map((x) => x.ruleId)).toContain('unresolved_safety');
    expect(['urgent', 'emergency']).toContain(r.urgency.level);
  });
});

describe('history isolation', () => {
  it('keeps unrelated earlier checks out of a new assessment', () => {
    const memory: MemoryItem[] = [
      { id: 'M1', kind: 'past_check', label: 'Earlier check', text: 'Headache with a stiff neck', recordedAt: '2026-10-01T00:00:00Z', href: '/summary/a', checkId: 'a', concernCode: 'headache' },
      { id: 'M2', kind: 'allergy', label: 'Allergy', text: 'Penicillin', recordedAt: '2026-01-01T00:00:00Z', href: '/settings' },
    ];
    const now = new Date('2026-10-13T00:00:00Z');
    expect(relevantMemory(memory, null, recurrence(demoBundle, ['sore_throat'], memory, now)).map((m) => m.id)).toEqual(['M2']);
    expect(relevantMemory(memory, null, recurrence(demoBundle, ['headache'], memory, now)).map((m) => m.id)).toEqual(['M1', 'M2']);
  });
});

describe('triage consistency', () => {
  const cases: [string, FactMap, string | undefined][] = [
    ['sore throat with fever and glands', { sore_throat: P(), fever: P(), temperature_c: P(38.4), swollen_glands: P(), cough: A, duration_days: P(3) }, undefined],
    ['animal bite', { animal_bite: P(), animal_bite_days: P(1), bite_bleeding: A, snake_bite: A }, undefined],
    ['cold without warning signs', { runny_nose: P(), fever: A, duration_days: P(2) }, undefined],
    ['fever for four days', { fever: P(), duration_days: P(4), rash: A }, undefined],
  ];

  it.each(cases)('%s: the urgency is the same with AI off, failing or writing unsafe text', async (_name, facts, message) => {
    const [off, failing, hostile] = await Promise.all((['off', 'failing', 'hostile'] as const).map((m) => runAssessment(deps(m), input(facts, message))));
    const decision = (o: typeof off) => [o.result!.urgency.level, o.result!.urgency.reasons.map((r) => r.ruleId), o.result!.triage];
    expect(decision(failing)).toEqual(decision(off));
    expect(decision(hostile)).toEqual(decision(off));
    expect(hostile.result!.summary).not.toMatch(/strep|amoxicillin|likely/i);
  });
});

describe('citations support their claims', () => {
  const sources = new Map(demoKnowledge.map((k) => [k.sourceKey, k]));
  type Claim = { id: string; text: string; sourceKey: string; heading?: string; review?: string; level?: UrgencyLevel };
  const claims: Claim[] = [
    ...demoBundle.urgencyRules.map((r) => ({ id: r.id, text: r.message, sourceKey: r.sourceKey, heading: r.sourceHeading, review: r.review, level: r.level })),
    ...Object.entries(demoBundle.careItems).map(([id, c]) => ({ id, text: c.text, sourceKey: c.sourceKey, heading: c.sourceHeading, review: c.review })),
    ...demoBundle.concerns.flatMap((c) => c.information.map((i) => ({ id: i.code, text: i.text, sourceKey: i.sourceKey, heading: i.sourceHeading }))),
  ];
  const cited = claims.filter((c) => c.heading);
  const passageOf = (c: Claim) => sources.get(c.sourceKey)!.chunks.find((x) => x.heading === c.heading)!;
  const numbers = (text: string) => (text.replace(/\b(112|14416|24–48)\b/g, '').match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const conditions = (text: string) => (text.toLowerCase().match(new RegExp(`\\b${CONDITION}\\b`, 'g')) ?? []).map((w) => w.replace(/s$/, ''));

  it('every urgency rule names the passage behind it, or says what a clinician still has to decide', () => {
    expect(demoBundle.urgencyRules.filter((r) => !r.sourceHeading && !r.review).map((r) => r.id)).toEqual([]);
  });

  it.each(cited.map((c) => [c.id, c] as const))('%s cites a passage that exists and says the same thing', (_id, c) => {
    const source = sources.get(c.sourceKey);
    expect(source, `missing source ${c.sourceKey}`).toBeDefined();
    expect(source!.chunks.map((x) => x.heading)).toContain(c.heading);
    const passage = bestPassage(source!.chunks, c.text, c.heading)!;
    expect(passage.heading).toBe(c.heading);
    expect(supports(passage, c.text, c.heading)).toBe(true);
    expect(claimOverlap(c.text, passage.text)).toBeGreaterThanOrEqual(1);
  });

  it('only cites numbers its passage gives, unless a clinician has to review them', () => {
    const unsupported = cited.filter((c) => !c.review).flatMap((c) => {
      const given = new Set(numbers(passageOf(c).text));
      return numbers(c.text).filter((n) => !given.has(n)).map((n) => `${c.id}: ${n}`);
    });
    expect(unsupported).toEqual([]);
  });

  it('names a condition only when its passage names it', () => {
    const unsupported = cited.flatMap((c) => {
      const named = new Set(conditions(passageOf(c).text + ' ' + passageOf(c).heading));
      return conditions(c.text).filter((w) => !named.has(w)).map((w) => `${c.id}: ${w}`);
    });
    expect(unsupported).toEqual([]);
  });

  it('is never less urgent than the passage it cites, unless a clinician has to review it', () => {
    const below = cited.filter((c) => {
      const tier = passageOf(c).tier;
      return c.level && tier && !c.review && urgencyRank(c.level) < urgencyRank(tier);
    });
    expect(below.map((c) => `${c.id} ${c.level} < ${passageOf(c).tier}`)).toEqual([]);
  });

  it('cites general fever information to the general fever page, not to a page about one disease', () => {
    const fever = demoBundle.concerns.find((c) => c.code === 'fever')!;
    for (const key of fever.sourceKeys) expect(conditions(sources.get(key)!.title).filter((d) => d !== 'flu'), key).toEqual([]);
    const searchable = demoKnowledge.filter((k) => k.concernCodes.includes('fever')).map((k) => k.title.toLowerCase());
    expect(searchable.join(' ')).not.toMatch(/dengue|malaria|typhoid/);
    for (const i of fever.information) {
      const title = sources.get(i.sourceKey)!.title.toLowerCase();
      const diseases = conditions(title);
      for (const d of diseases) expect(i.text.toLowerCase(), `${i.code} cites ${title}`).toContain(d);
    }
  });

  it('shows no citation rather than an unrelated one', async () => {
    const r = (await runAssessment(deps('off'), input({ sore_throat: P(), fever: P(), temperature_c: P(38.4), swollen_glands: P(), cough: A, duration_days: P(3) }))).result!;
    expect(r.urgency.level).toBe('urgent');
    expect(r.carePlan.find((c) => c.id === 'ci_urgent_today')!.citations).toEqual([]);
    const older = (await runAssessment(deps('off'), input({ age: P(70), fever: P(), duration_days: P(1), rash: A }))).result!;
    expect(older.urgency.reasons.find((x) => x.ruleId === 'r_older_fever')!.citations).toEqual([]);
    const byId = new Map(r.evidence.map((e) => [e.citationId, e]));
    const items = [...r.urgency.reasons.map((x) => ({ text: x.message, citations: x.citations })), ...r.carePlan, ...(r.information ?? [])];
    for (const item of items) for (const id of item.citations) expect(claimOverlap(item.text, byId.get(id)!.excerpt)).toBeGreaterThanOrEqual(1);
  });

  it('contains no steam inhalation or hot-water advice anywhere', () => {
    const all = JSON.stringify([demoBundle, demoKnowledge]).toLowerCase();
    expect(all).not.toMatch(/steam|hot water|boiling|inhal/);
  });

  it('cites the passage each care item and topic names in a finished result', async () => {
    const r = (await runAssessment(deps('off'), input({ animal_bite: P(), animal_bite_days: P(1), bite_bleeding: A, snake_bite: A }))).result!;
    const byId = new Map(r.evidence.map((e) => [e.citationId, e]));
    const wash = r.carePlan.find((c) => c.id === 'ci_bite_wash')!;
    expect(byId.get(wash.citations[0]!)).toMatchObject({ sourceKey: 'src_rabies', heading: 'First aid' });
    const rabies = r.information!.find((i) => i.code === 'info_rabies')!;
    expect(byId.get(rabies.citations[0]!)).toMatchObject({ sourceKey: 'src_rabies', heading: 'How rabies spreads' });
  });
});

describe('non-diagnostic content', () => {
  it('has no source passage that ranks causes', () => {
    for (const k of demoKnowledge) for (const c of k.chunks) expect(`${k.sourceKey}: ${c.text}`).not.toMatch(/\b(most|more|less) likely\b/i);
  });

  it('has no ranked or likely causes in approved content', () => {
    for (const c of demoBundle.concerns) expect(c.explanations).toEqual([]);
    const texts = [
      ...demoBundle.concerns.flatMap((c) => c.information.flatMap((i) => [i.title, i.text])),
      ...Object.values(demoBundle.careItems).map((c) => c.text),
      ...Object.values(demoBundle.questions).flatMap((q) => [q.text, q.why ?? '']),
      ...demoBundle.urgencyRules.filter((r) => r.level !== 'emergency').map((r) => r.message),
    ];
    for (const t of texts) expect(t).not.toMatch(/\b(most|more|less) likely\b|\blikelihood\b|\byou have (a |an )?(\w+ )?infection\b/i);
  });
});
