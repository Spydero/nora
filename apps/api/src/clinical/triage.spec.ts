import { mapAnswer } from '../checks/answer-mapping.js';
import { understoodNotice } from '../checks/assessment.worker.js';
import { applyHedged, applyObservations } from '../assessment/extraction/llm-extractor.js';
import { extractWithRules, hedgedMentions } from '../assessment/extraction/rule-extractor.js';
import { citedEvidence } from '../assessment/graph/compose.js';
import type { EvidenceRef, ResultContent } from '../assessment/result.types.js';
import { demoBundle } from './content/demo-bundle.js';
import { detectConcerns, type FactMap, planQuestions, UNCLEAR_SOURCE } from './rules-engine.js';
import { triage } from './triage.js';

const adult: FactMap = { age: { state: 'PRESENT', value: 34, source: 'profile' } };
const P = { state: 'PRESENT' as const, source: 'answer' };
const A = { state: 'ABSENT' as const, source: 'answer' };
const plan = (facts: FactMap, asked: string[] = []) => planQuestions(demoBundle, facts, detectConcerns(demoBundle, facts), new Set(asked));
const screened = ['q_main_concern', 'q_age', 'q_red_flags', 'q_ws_throat'];

describe('rule-based triage', () => {
  it('decides urgency, reasons and missing safety information from the rules alone', () => {
    const facts: FactMap = { ...adult, sore_throat: P, fever: P, swollen_glands: P, cough: A, drooling: { state: 'UNKNOWN', source: 'answer' } };
    const decision = triage(demoBundle, facts, detectConcerns(demoBundle, facts));
    expect(decision.decidedBy).toBe('rules');
    expect(decision.reasons.map((r) => r.ruleId)).toContain('unresolved_safety');
    expect(decision.missingSafety).toEqual(expect.arrayContaining([{ key: 'drooling', label: demoBundle.facts.drooling!.label, gap: 'unsure' }]));
    expect(decision.missingSafety.find((m) => m.key === 'breathless_severe')?.gap).toBe('not_asked');
    expect(decision.missingRequired.map((m) => m.key)).toContain('duration_days');
  });

  it('reports only the concern’s own unasked warning signs, not every red flag Nora knows', () => {
    const facts: FactMap = { ...adult, sore_throat: P, drooling: A, breathless_severe: A, lip_throat_swelling: A, difficulty_swallowing: A };
    const keys = triage(demoBundle, facts, detectConcerns(demoBundle, facts)).missingSafety.map((m) => m.key);
    expect(keys).not.toContain('stiff_neck');
    expect(keys).not.toContain('chest_pain');
  });
});

describe('question order', () => {
  const throat: FactMap = { ...adult, sore_throat: P };

  it('asks about a recent check right after the warning signs, and only when there is one', () => {
    const order = plan({ ...throat, prior_similar_check: { state: 'PRESENT', source: 'memory' } }, screened).map((q) => q.id);
    expect(order[0]).toBe('q_episode');
    expect(plan(throat, screened).map((q) => q.id)).not.toContain('q_episode');
  });

  it('ends with the optional "anything else" question, asked once', () => {
    const order = plan(throat).map((q) => q.id);
    expect(order.at(-1)).toBe('q_anything_else');
    expect(demoBundle.questions.q_anything_else!.text).toBe('Is there anything else you’d like us to know?');
    expect(plan(throat, ['q_anything_else']).map((q) => q.id)).not.toContain('q_anything_else');
    expect(plan(adult).map((q) => q.id)).not.toContain('q_anything_else');
  });

  it('clarifies a hedged mention before routine detail instead of assuming either way', () => {
    const said = 'I have a sore throat, maybe a fever';
    expect(extractWithRules(demoBundle, said).map((o) => o.factKey)).not.toContain('fever');
    const hedged = hedgedMentions(demoBundle, said);
    expect(hedged.map((h) => h.factKey)).toEqual(['fever']);
    const facts = { ...adult, ...applyObservations(demoBundle, adult, extractWithRules(demoBundle, said)), ...applyHedged(adult, hedged, []) };
    expect(facts.fever).toEqual({ state: 'NOT_ASKED', source: UNCLEAR_SOURCE });
    const next = plan(facts, screened)[0]!;
    expect(next.id).toBe('q_fever');
    expect(next.reason).toBe('clarify');
  });

  it('reads "not sure if" as doubt, not as a denial', () => {
    expect(extractWithRules(demoBundle, 'sore throat, not sure if I have a fever').find((o) => o.factKey === 'fever')).toBeUndefined();
    expect(hedgedMentions(demoBundle, 'sore throat, not sure if I have a fever').map((h) => h.factKey)).toContain('fever');
    expect(extractWithRules(demoBundle, 'sore throat and no fever').find((o) => o.factKey === 'fever')?.state).toBe('ABSENT');
  });

  it('notices doubt after the symptom, but never softens a warning sign', () => {
    expect(hedgedMentions(demoBundle, 'Could be a fever too, not sure.').map((h) => h.factKey)).toEqual(['fever']);
    expect(hedgedMentions(demoBundle, 'A fever, I’m not sure').map((h) => h.factKey)).toEqual(['fever']);
    expect(extractWithRules(demoBundle, 'I have a fever, not sure why').find((o) => o.factKey === 'fever')?.state).toBe('PRESENT');
    expect(extractWithRules(demoBundle, 'I have a sore throat, maybe a fever').find((o) => o.factKey === 'sore_throat')?.state).toBe('PRESENT');
    expect(extractWithRules(demoBundle, 'could be chest pain, not sure').find((o) => o.factKey === 'chest_pain')?.state).toBe('PRESENT');
  });

  it('re-asks an earlier "no" the patient now doubts, but never weakens a "yes" or "not sure"', () => {
    const facts: FactMap = { ...adult, sore_throat: P, fever: A };
    const reopened = applyHedged(facts, [{ factKey: 'fever' }], []);
    expect(reopened).toEqual({ fever: { state: 'NOT_ASKED', source: UNCLEAR_SOURCE } });
    const next = plan({ ...facts, ...reopened }, [...screened, 'q_fever'])[0]!;
    expect(next).toMatchObject({ id: 'q_fever', reason: 'clarify' });
    expect(applyHedged({ fever: P }, [{ factKey: 'fever' }], [])).toEqual({});
    expect(applyHedged({ fever: { state: 'UNKNOWN', source: 'answer' } }, [{ factKey: 'fever' }], [])).toEqual({});
  });
});

describe('free-text answers', () => {
  const q = demoBundle.questions.q_anything_else!;

  it('keeps the patient’s words and sets no facts by itself', () => {
    expect(mapAnswer(q, '  I work night shifts  ')).toEqual({ facts: {}, label: 'I work night shifts', written: true });
    expect(mapAnswer(q, null).label).toBe('Skipped');
    expect(() => mapAnswer(q, '   ')).toThrow();
  });

  it('treats a plain "no" as nothing more to add, not as a note for the doctor', () => {
    for (const nothing of ['no', 'No.', 'nothing else', 'That’s all', 'n/a']) expect(mapAnswer(q, nothing).written).toBeUndefined();
    expect(mapAnswer(q, 'No fever but my ears hurt').written).toBe(true);
  });

  it('tells the patient what Nora took from it', () => {
    const observations = extractWithRules(demoBundle, 'I have swollen glands and no cough');
    const text = understoodNotice(demoBundle, observations, ['fever']);
    expect(text).toMatch(/Nora understood that you have .*swollen/i);
    expect(text).toMatch(/you don’t have cough/i);
    expect(text).toMatch(/unsure about fever/i);
    expect(understoodNotice(demoBundle, [], [])).toMatch(/didn’t find anything/);
    expect(understoodNotice(demoBundle, [], ['fever'])).not.toMatch(/didn’t find anything/);
  });
});

describe('sources', () => {
  const ref = (n: number, sourceKey: string): EvidenceRef => ({
    citationId: `E${n}`,
    chunkId: `c${n}`,
    documentId: `d${n}`,
    sourceKey,
    version: 1,
    title: sourceKey,
    publisher: 'NHS',
    heading: null,
    excerpt: '',
    url: null,
  });

  it('lists only sources the result cites, numbered in order of use', () => {
    const result = {
      summary: 'See [E5].',
      urgency: { level: 'soon', title: '', text: '', reasons: [{ ruleId: 'r', message: '', citations: ['E3'] }] },
      information: [{ code: 'x', title: '', text: '', citations: ['E3'] }],
      carePlan: [{ id: 'ci', kind: 'self_care', text: '', citations: ['E5'] }],
      evidence: [ref(1, 'src_meningitis'), ref(2, 'src_other'), ref(3, 'src_throat'), ref(4, 'src_unused'), ref(5, 'src_self_care')],
    } as unknown as ResultContent;
    const out = citedEvidence(result);
    expect(out.evidence.map((e) => [e.citationId, e.sourceKey])).toEqual([
      ['E1', 'src_throat'],
      ['E2', 'src_self_care'],
    ]);
    expect(out.urgency.reasons[0]!.citations).toEqual(['E1']);
    expect(out.information![0]!.citations).toEqual(['E1']);
    expect(out.carePlan[0]!.citations).toEqual(['E2']);
    expect(out.summary).toBe('See [E2].');
  });
});
