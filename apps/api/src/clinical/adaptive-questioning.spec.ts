import { type AnswerValue, mapAnswer } from '../checks/answer-mapping.js';
import { applyObservations } from '../assessment/extraction/llm-extractor.js';
import { extractWithRules } from '../assessment/extraction/rule-extractor.js';
import type { QuestionDef } from './bundle.schema.js';
import { demoBundle } from './content/demo-bundle.js';
import {
  detectConcerns,
  evaluateUrgency,
  type FactMap,
  isOpen,
  missingRequiredFacts,
  nextQuestion,
  planQuestions,
  presentQuestion,
  questionFactKeys,
  safetyFacts,
  unresolvedSafety,
} from './rules-engine.js';

const adult: FactMap = { age: { state: 'PRESENT', value: 34, source: 'profile' } };
const P = { state: 'PRESENT' as const, source: 'answer' };
const A = { state: 'ABSENT' as const, source: 'answer' };

type Policy = (q: QuestionDef, id: string) => AnswerValue;

const NUMBERS: Record<string, number> = { age: 34, duration_days: 2, temperature_c: 37.2, pain_score: 3 };
const number = (q: QuestionDef) => NUMBERS[q.factKey ?? ''] ?? q.min ?? 1;

/** A patient who has none of the warning signs or risk factors. */
const sayNo: Policy = (q) => {
  if (q.type === 'text') return null;
  if (q.type === 'yes_no') return 'no';
  if (q.type === 'number') return number(q);
  const opts = q.options ?? [];
  return [(opts.find((o) => o.value === 'none') ?? opts.find((o) => o.exclusive && !o.unsure) ?? opts[0]!).value];
};

/** A patient who isn't sure about anything they can be unsure about, and skips the rest when allowed. */
const notSure: Policy = (q, id) => {
  if (q.type === 'yes_no') return 'unsure';
  if (q.type === 'number') return q.allowSkip ? null : number(q);
  const unsure = (q.options ?? []).find((o) => o.unsure);
  return unsure ? [unsure.value] : sayNo(q, id);
};

/** Runs the questioning loop the way the assessment does: stop on an emergency or when the plan is empty. */
function simulate(start: FactMap, policy: Policy) {
  let facts: FactMap = { ...adult, ...start };
  const asked: string[] = [];
  for (let i = 0; i < Object.keys(demoBundle.questions).length + 1; i++) {
    const concerns = detectConcerns(demoBundle, facts);
    if (evaluateUrgency(demoBundle, facts, concerns).level === 'emergency') return { facts, asked, concerns, done: 'emergency' as const };
    const q = nextQuestion(demoBundle, facts, concerns, new Set(asked));
    if (!q) return { facts, asked, concerns, done: 'complete' as const };
    asked.push(q.id);
    const shown = presentQuestion(q.question, facts);
    facts = { ...facts, ...mapAnswer(shown, policy(shown, q.id)).facts };
  }
  throw new Error(`Questioning did not finish: ${asked.join(', ')}`);
}

const concernStarts = demoBundle.concerns.map((c) => [c.code, { [c.triggers[0]!]: P }] as const);

describe('adaptive questioning', () => {
  describe.each(concernStarts)('%s', (_code, start) => {
    it('keeps asking until warning signs are screened and required facts are known, without repeating a question', () => {
      const run = simulate(start, sayNo);
      expect(run.done).toBe('complete');
      expect(new Set(run.asked).size).toBe(run.asked.length);
      expect(missingRequiredFacts(demoBundle, run.facts, run.concerns)).toEqual([]);
      const screened = run.concerns.flatMap((c) => c.questions.filter((id) => demoBundle.questions[id]!.purpose === 'safety').flatMap((id) => questionFactKeys(demoBundle.questions[id]!)));
      expect(screened.length).toBeGreaterThan(0);
      expect(screened.filter((k) => isOpen(run.facts[k]))).toEqual([]);
      const presenting = new Set(run.concerns.flatMap((c) => c.triggers));
      expect(safetyFacts(demoBundle, run.concerns).filter((k) => !presenting.has(k) && run.facts[k]?.state === 'PRESENT')).toEqual([]);
      expect(unresolvedSafety(demoBundle, run.facts, run.concerns)).toEqual([]);
    });

    it('never treats "not sure" about a warning sign as reassurance', () => {
      const run = simulate(start, notSure);
      const unresolved = unresolvedSafety(demoBundle, run.facts, run.concerns);
      if (run.done === 'emergency' || unresolved.length === 0) return;
      const urgency = evaluateUrgency(demoBundle, run.facts, run.concerns);
      expect(urgency.triggered.map((t) => t.ruleId)).toContain('unresolved_safety');
      expect(['soon', 'urgent', 'emergency']).toContain(urgency.level);
    });

    it('asks about the concern’s own warning signs first', () => {
      const facts = { ...adult, ...start };
      expect(nextQuestion(demoBundle, facts, detectConcerns(demoBundle, facts), new Set())?.reason).toBe('safety');
    });
  });

  it('has no fixed question budget: a complex case can go beyond the old 12-question cap', () => {
    const longest = Math.max(...concernStarts.map(([, start]) => simulate(start, sayNo).asked.length));
    const plan = (start: FactMap) => planQuestions(demoBundle, { ...adult, ...start }, detectConcerns(demoBundle, { ...adult, ...start }), new Set()).length;
    expect(longest).toBeGreaterThan(5);
    expect(Math.max(...concernStarts.map(([, s]) => plan(s)))).toBeGreaterThanOrEqual(longest - 1);
  });

  it('skips what the patient already said in their own words', () => {
    const facts: FactMap = { ...adult, sore_throat: P, fever: P, duration_days: { state: 'PRESENT', value: 3, source: 'rules' }, temperature_c: { state: 'PRESENT', value: 38.5, source: 'llm' }, cough: A };
    const run = simulate(facts, sayNo);
    for (const id of ['q_fever', 'q_duration', 'q_temperature', 'q_cough']) expect(run.asked).not.toContain(id);
  });

  it('understands phrases that rule something out, like "dry cough" meaning no phlegm', () => {
    const observed = (text: string) => extractWithRules(demoBundle, text).find((o) => o.factKey === 'cough_productive')?.state;
    expect(observed('I have a dry cough since 3 days')).toBe('ABSENT');
    expect(observed('A dry cough at first, now I cough up green phlegm')).toBe('PRESENT');
    expect(observed('It is not a dry cough')).toBeUndefined();
    const run = simulate(applyObservations(demoBundle, adult, extractWithRules(demoBundle, 'Dry cough for 3 days')), sayNo);
    expect(run.asked).not.toContain('q_productive');
  });

  it('asks risk-factor questions only when the answer could change the advice', () => {
    const base: FactMap = { ...adult, ear_pain: P };
    expect(simulate({ ...base, fever: A }, sayNo).asked).not.toContain('q_immuno');
    expect(simulate({ ...base, fever: P }, sayNo).asked).toContain('q_immuno');
  });

  it('does not ask history questions the profile already answered', () => {
    const facts: FactMap = { cough: P, fever: P, chronic_lung_disease: { state: 'PRESENT', source: 'profile' }, immunocompromised: { state: 'ABSENT', source: 'profile' } };
    const run = simulate(facts, sayNo);
    expect(run.asked).not.toContain('q_lung_disease');
    expect(run.asked).not.toContain('q_immuno');
  });

  it('follows up on a "yes" with the questions it makes important', () => {
    const risk = ['q_temperature', 'q_heart_disease', 'q_diabetes', 'q_immuno'];
    const withFever = simulate({ runny_nose: P }, (q, id) => (id === 'q_fever' ? 'yes' : sayNo(q, id)));
    const noFever = simulate({ runny_nose: P }, sayNo);
    for (const id of risk) expect(withFever.asked).toContain(id);
    for (const id of risk) expect(noFever.asked).not.toContain(id);
  });

  it('stops asking as soon as an answer means emergency care', () => {
    const run = simulate({ headache: P }, (q, id) => (id === 'q_ws_headache' ? ['head_injury'] : sayNo(q, id)));
    expect(run.done).toBe('emergency');
    expect(run.asked).toEqual(['q_ws_headache']);
  });

  it('escalates when a warning sign is described mid-way, whatever was asked so far', () => {
    const mid = simulate({ sore_throat: P }, sayNo).facts;
    const said = { ...mid, ...applyObservations(demoBundle, mid, extractWithRules(demoBundle, 'and now my lips and tongue are swelling up')) };
    expect(evaluateUrgency(demoBundle, said, detectConcerns(demoBundle, said)).level).toBe('emergency');
  });
});

describe('emergency red flags in free text', () => {
  const single = demoBundle.urgencyRules.filter((r) => r.level === 'emergency' && !r.concerns && 'fact' in r.when && 'is' in r.when && r.when.is === 'present');
  const cases = single.flatMap((r) => {
    const key = (r.when as { fact: string }).fact;
    return demoBundle.facts[key]!.synonyms.map((s) => [r.id, s] as const);
  });

  it.each(cases)('%s: "%s" escalates to emergency', (_rule, phrase) => {
    const facts = { ...adult, ...applyObservations(demoBundle, adult, extractWithRules(demoBundle, `I have ${phrase}`)) };
    expect(evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts)).level).toBe('emergency');
  });

  it('does not escalate when the red flag is denied', () => {
    const facts = { ...adult, ...applyObservations(demoBundle, adult, extractWithRules(demoBundle, 'I have a sore throat but no chest pain and no trouble breathing')) };
    expect(evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts)).level).not.toBe('emergency');
  });
});

describe('missing data', () => {
  it('a skipped warning-sign question never lowers urgency and is reported as missing', () => {
    const run = simulate({ headache: P }, (q, id) => (id === 'q_ws_headache' ? null : sayNo(q, id)));
    const urgency = evaluateUrgency(demoBundle, run.facts, run.concerns);
    expect(unresolvedSafety(demoBundle, run.facts, run.concerns).length).toBeGreaterThan(0);
    expect(urgency.level).not.toBe('self_care');
    expect(urgency.level).not.toBe('routine');
  });

  it('"Not sure" on a warning-sign list marks every listed sign as unknown', () => {
    const q = demoBundle.questions.q_ws_headache!;
    const mapped = mapAnswer(q, ['unsure']);
    for (const o of q.options!.filter((x) => x.factKey)) expect(mapped.facts[o.factKey!]).toEqual({ state: 'UNKNOWN', source: 'answer' });
    expect(() => mapAnswer(q, ['unsure', 'stiff_neck'])).toThrow();
  });
});
