import { AIMessage } from '@langchain/core/messages';
import { ScriptedDecisions } from '../ai/decisions.js';
import { ScriptedChatModel } from '../ai/scripted-chat-model.js';
import { demoBundle } from '../clinical/content/demo-bundle.js';
import { demoKnowledge } from '../clinical/content/knowledge.js';
import { detectConcerns, evaluateUrgency, type FactMap, planQuestions, runSentinels } from '../clinical/rules-engine.js';
import { InMemoryKnowledge } from '../knowledge/in-memory-knowledge.js';
import type { MemoryItem } from '../memory/memory.types.js';
import { applyObservations, guardConfirmed, validateObservations } from './extraction/llm-extractor.js';
import { extractWithRules } from './extraction/rule-extractor.js';
import { type AssessmentDeps, type AssessmentInput, runAssessment } from './graph/assessment-graph.js';
import { findings, relevantMemory } from './graph/compose.js';
import { bestPassage, claimOverlap, MIN_SUPPORT, supports } from './graph/evidence-registry.js';

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
    expect(value(facts, 'exposure_days')).toBe(5);
    expect(value(facts, 'duration_days')).toBe(1);
  });

  it('does not take how long someone has had a condition as how long the symptoms have lasted', () => {
    const facts = read('I have had diabetes for 10 years and a cough for 3 days');
    expect(value(facts, 'duration_days')).toBe(3);
    expect(facts.diabetes?.state).toBe('PRESENT');
  });

  it('records a bite on its own without inventing a symptom duration', () => {
    const facts = read('I was bitten by a dog 2 weeks ago');
    expect(value(facts, 'exposure_days')).toBe(14);
    expect(facts.duration_days).toBeUndefined();
  });

  it('drops a model reading that takes an exposure date as the symptom duration', () => {
    const message = 'A dog bit me 5 days ago and I have a fever since yesterday';
    const kept = validateObservations(demoBundle, message, [
      { factKey: 'duration_days', state: 'PRESENT', value: 5, quote: 'bit me 5 days ago', assertion: 'affirmed' },
      { factKey: 'exposure_days', state: 'PRESENT', value: 5, quote: 'bit me 5 days ago', assertion: 'affirmed' },
    ]);
    expect(kept.map((o) => o.factKey)).toEqual(['exposure_days']);
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
    expect(f.exposures!.map((i) => i.key)).toEqual(expect.arrayContaining(['animal_bite', 'exposure_days']));
    expect(f.present.map((i) => i.key)).not.toContain('animal_bite');
    expect(f.present.map((i) => i.key)).toContain('fever');
  });
});

describe('adaptive questioning', () => {
  const plan = (facts: FactMap, asked: string[] = []) => planQuestions(demoBundle, facts, detectConcerns(demoBundle, facts), new Set(asked)).map((p) => p.id);

  it('screens a bite’s warning signs first and asks when it happened only if the patient did not say', () => {
    const told = read('A dog bit me 3 days ago');
    expect(plan(told)[0]).toBe('q_ws_bite');
    expect(plan(told)).not.toContain('q_exposure_days');
    expect(plan(read('A dog bit my leg'))).toContain('q_exposure_days');
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

describe('unknown answers', () => {
  it('never treats "not sure" about a bite warning sign as a no', async () => {
    const out = await runAssessment(deps('off'), input({ animal_bite: P(), exposure_days: P(2), bite_bleeding: U, snake_bite: A, breathless_severe: A, lip_throat_swelling: A }));
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
    expect(relevantMemory(memory, ['sore_throat']).map((m) => m.id)).toEqual(['M2']);
    expect(relevantMemory(memory, ['headache']).map((m) => m.id)).toEqual(['M1', 'M2']);
  });
});

describe('triage consistency', () => {
  const cases: [string, FactMap, string | undefined][] = [
    ['sore throat with fever and glands', { sore_throat: P(), fever: P(), temperature_c: P(38.4), swollen_glands: P(), cough: A, duration_days: P(3) }, undefined],
    ['animal bite', { animal_bite: P(), exposure_days: P(1), bite_bleeding: A, snake_bite: A }, undefined],
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
  const claims = [
    ...demoBundle.urgencyRules.map((r) => ({ id: r.id, text: r.message, sourceKey: r.sourceKey, heading: r.sourceHeading })),
    ...Object.entries(demoBundle.careItems).map(([id, c]) => ({ id, text: c.text, sourceKey: c.sourceKey, heading: c.sourceHeading })),
    ...demoBundle.concerns.flatMap((c) => c.information.map((i) => ({ id: i.code, text: i.text, sourceKey: i.sourceKey, heading: i.sourceHeading }))),
  ];

  /** Steps that only say where and when to get care; their support is the urgency reason, so they carry no citation. */
  const NAVIGATION = new Set(['ci_urgent_today', 'ci_soon_gp']);

  it.each(claims.map((c) => [c.id, c] as const))('%s cites a passage that exists and says the same thing', (id, c) => {
    const source = sources.get(c.sourceKey);
    expect(source, `missing source ${c.sourceKey}`).toBeDefined();
    if (c.heading) expect(source!.chunks.map((x) => x.heading)).toContain(c.heading);
    const passage = bestPassage(source!.chunks, c.text, c.heading)!;
    if (NAVIGATION.has(id)) {
      expect(supports(passage, c.text, c.heading)).toBe(false);
      return;
    }
    expect(supports(passage, c.text, c.heading)).toBe(true);
    expect(claimOverlap(c.text, passage.text)).toBeGreaterThanOrEqual(c.heading ? 1 : MIN_SUPPORT);
  });

  it('shows no citation rather than an unrelated one', async () => {
    const r = (await runAssessment(deps('off'), input({ sore_throat: P(), fever: P(), temperature_c: P(38.4), swollen_glands: P(), cough: A, duration_days: P(3) }))).result!;
    expect(r.urgency.level).toBe('soon');
    expect(r.carePlan.find((c) => c.id === 'ci_soon_gp')!.citations).toEqual([]);
    const byId = new Map(r.evidence.map((e) => [e.citationId, e]));
    const items = [...r.urgency.reasons.map((x) => ({ text: x.message, citations: x.citations })), ...r.carePlan, ...(r.information ?? [])];
    for (const item of items) for (const id of item.citations) expect(claimOverlap(item.text, byId.get(id)!.excerpt)).toBeGreaterThanOrEqual(1);
  });

  it('contains no steam inhalation or hot-water advice anywhere', () => {
    const all = JSON.stringify([demoBundle, demoKnowledge]).toLowerCase();
    expect(all).not.toMatch(/steam|hot water|boiling|inhal/);
  });

  it('cites the passage each care item and topic names in a finished result', async () => {
    const r = (await runAssessment(deps('off'), input({ animal_bite: P(), exposure_days: P(1), bite_bleeding: A, snake_bite: A }))).result!;
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
