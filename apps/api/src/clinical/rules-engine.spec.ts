import { bundleContentSchema } from './bundle.schema.js';
import { demoBundle } from './content/demo-bundle.js';
import {
  checkScope,
  detectConcerns,
  evaluate,
  evaluateUrgency,
  type FactMap,
  missingRequiredFacts,
  nextQuestion,
  presentQuestion,
  runSentinels,
} from './rules-engine.js';

const adult: FactMap = { age: { state: 'PRESENT', value: 34 } };

describe('demo clinical bundle', () => {
  it('passes schema and cross-reference validation', () => {
    const parsed = bundleContentSchema.safeParse(demoBundle);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.message)).toEqual([]);
  });

  it('passes every sentinel case', () => {
    const { passed, results } = runSentinels(demoBundle);
    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(passed).toBe(true);
  });

  it('has an emergency sentinel for every emergency rule', () => {
    const emergencyRules = demoBundle.urgencyRules.filter((r) => r.level === 'emergency').map((r) => r.id);
    const covered = new Set<string>();
    for (const s of demoBundle.sentinels.filter((x) => x.expectedLevel === 'emergency')) {
      const facts: FactMap = { ...adult };
      for (const [k, v] of Object.entries(s.facts)) facts[k] = typeof v === 'number' ? { state: 'PRESENT', value: v } : { state: v };
      const concerns = demoBundle.concerns.filter((c) => c.code === s.concern);
      evaluateUrgency(demoBundle, facts, concerns).triggered.forEach((t) => covered.add(t.ruleId));
    }
    expect(emergencyRules.filter((id) => !covered.has(id))).toEqual([]);
  });
});

describe('condition evaluation', () => {
  it('treats unknown, declined and unasked as not present', () => {
    for (const state of ['UNKNOWN', 'DECLINED', 'NOT_ASKED'] as const) {
      expect(evaluate({ fact: 'chest_pain', is: 'present' }, { chest_pain: { state } })).toBe(false);
      expect(evaluate({ fact: 'chest_pain', is: 'absent' }, { chest_pain: { state } })).toBe(false);
      expect(evaluate({ fact: 'chest_pain', is: 'unknown' }, { chest_pain: { state } })).toBe(true);
    }
  });

  it('compares numeric facts only when present with a value', () => {
    expect(evaluate({ fact: 'temperature_c', gte: 39.5 }, { temperature_c: { state: 'PRESENT', value: 39.5 } })).toBe(true);
    expect(evaluate({ fact: 'temperature_c', gte: 39.5 }, { temperature_c: { state: 'PRESENT', value: 38 } })).toBe(false);
    expect(evaluate({ fact: 'temperature_c', gte: 39.5 }, { temperature_c: { state: 'UNKNOWN' } })).toBe(false);
  });

  it('supports nested all/any/not', () => {
    const facts: FactMap = { fever: { state: 'PRESENT' }, cough: { state: 'ABSENT' } };
    expect(evaluate({ all: [{ fact: 'fever', is: 'present' }, { not: { fact: 'cough', is: 'present' } }] }, facts)).toBe(true);
    expect(evaluate({ any: [{ fact: 'cough', is: 'present' }, { fact: 'rash', is: 'present' }] }, facts)).toBe(false);
  });
});

describe('urgency', () => {
  it('escalates to emergency regardless of concern defaults', () => {
    const facts: FactMap = { ...adult, sore_throat: { state: 'PRESENT' }, chest_pain: { state: 'PRESENT' } };
    const outcome = evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts));
    expect(outcome.level).toBe('emergency');
    expect(outcome.triggered[0]?.ruleId).toBe('r_chest_pain');
  });

  it('applies concern-scoped rules only to that concern', () => {
    const facts: FactMap = { ...adult, headache: { state: 'PRESENT' }, duration_days: { state: 'PRESENT', value: 8 } };
    const outcome = evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts));
    expect(outcome.triggered.map((t) => t.ruleId)).not.toContain('r_sore_throat_long');
  });

  it('treats a "get help if…" warning that has already happened as a reason to escalate', () => {
    const facts: FactMap = { ...adult, headache: { state: 'PRESENT' }, stiff_neck: { state: 'PRESENT' }, fever: { state: 'ABSENT' } };
    const outcome = evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts));
    expect(outcome.level).toBe('emergency');
    expect(outcome.triggered[0]).toMatchObject({ ruleId: 'warn:ci_headache_monitor', level: 'emergency' });
    expect(outcome.triggered[0]!.message).toContain('stiff neck');
    expect(outcome.triggered.map((t) => t.ruleId)).not.toContain('warning_sign:stiff_neck');
  });

  it('never leaves a warning sign below "see a doctor soon", even when no rule covers it', () => {
    const facts: FactMap = { ...adult, sore_throat: { state: 'PRESENT' }, stiff_neck: { state: 'PRESENT' }, fever: { state: 'ABSENT' } };
    const outcome = evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts));
    expect(outcome.level).toBe('soon');
    expect(outcome.triggered.map((t) => t.ruleId)).toEqual(['warning_sign:stiff_neck']);
  });

  it('every critical yes/no fact raises urgency above self-care with any concern', () => {
    const critical = Object.entries(demoBundle.facts).filter(([, f]) => f.critical && f.type === 'boolean').map(([k]) => k);
    for (const concern of demoBundle.concerns) {
      for (const key of critical) {
        const facts: FactMap = { ...adult, [concern.triggers[0]!]: { state: 'PRESENT' }, [key]: { state: 'PRESENT' } };
        const level = evaluateUrgency(demoBundle, facts, [concern]).level;
        expect([concern.code, key, level]).not.toEqual([concern.code, key, expect.stringMatching(/^(self_care|routine)$/)]);
      }
    }
  });

  it('a skipped red-flag answer never lowers urgency below the concern default', () => {
    const facts: FactMap = { ...adult, dysuria: { state: 'PRESENT' }, flank_pain: { state: 'UNKNOWN' } };
    expect(evaluateUrgency(demoBundle, facts, detectConcerns(demoBundle, facts)).level).toBe('soon');
    expect(missingRequiredFacts(demoBundle, facts, detectConcerns(demoBundle, facts))).toContain('flank_pain');
  });
});

describe('scope', () => {
  it('excludes minors and pregnancy', () => {
    const facts: FactMap = { age: { state: 'PRESENT', value: 15 }, cough: { state: 'PRESENT' } };
    expect(checkScope(demoBundle, facts, detectConcerns(demoBundle, facts)).exclusionId).toBe('x_minor');
    const pregnant: FactMap = { ...adult, pregnant: { state: 'PRESENT' }, cough: { state: 'PRESENT' } };
    expect(checkScope(demoBundle, pregnant, detectConcerns(demoBundle, pregnant)).exclusionId).toBe('x_pregnancy');
  });

  it('flags unsupported concerns', () => {
    expect(checkScope(demoBundle, adult, []).exclusionId).toBe('x_unsupported_concern');
  });
});

describe('concern detection', () => {
  it('prefers a specific concern over a general one', () => {
    const facts: FactMap = { sore_throat: { state: 'PRESENT' }, fever: { state: 'PRESENT' }, runny_nose: { state: 'PRESENT' } };
    expect(detectConcerns(demoBundle, facts).map((c) => c.code)).toEqual(['sore_throat']);
  });

  it('uses a single general concern when nothing specific matches', () => {
    expect(detectConcerns(demoBundle, { fever: { state: 'PRESENT' } }).map((c) => c.code)).toEqual(['fever']);
    expect(detectConcerns(demoBundle, { fever: { state: 'PRESENT' }, runny_nose: { state: 'PRESENT' } }).map((c) => c.code)).toEqual(['cold_flu']);
  });
});

describe('question selection', () => {
  it('asks age when unknown, then the concern’s own warning signs — not a generic screen', () => {
    const facts: FactMap = { sore_throat: { state: 'PRESENT' } };
    const concerns = detectConcerns(demoBundle, facts);
    expect(nextQuestion(demoBundle, facts, concerns, new Set())?.id).toBe('q_age');
    expect(nextQuestion(demoBundle, { ...facts, ...adult }, concerns, new Set())?.id).toBe('q_ws_throat');
    expect(nextQuestion(demoBundle, { ...facts, ...adult }, concerns, new Set(['q_ws_throat']))?.id).toBe('q_duration');
  });

  it('gives each concern different first questions', () => {
    const first = (fact: string) => {
      const facts: FactMap = { ...adult, [fact]: { state: 'PRESENT' } };
      return nextQuestion(demoBundle, facts, detectConcerns(demoBundle, facts), new Set())?.id;
    };
    const ids = ['sore_throat', 'headache', 'cough', 'rash', 'ear_pain', 'dizziness', 'fever', 'diarrhoea', 'runny_nose', 'back_pain', 'abdominal_pain', 'dysuria'].map(first);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('q_red_flags');
  });

  it('asks what the concern is, then the generic screen, only when no concern is recognised', () => {
    expect(nextQuestion(demoBundle, adult, [], new Set())?.id).toBe('q_main_concern');
    expect(nextQuestion(demoBundle, adult, [], new Set(['q_main_concern']))?.id).toBe('q_red_flags');
    expect(nextQuestion(demoBundle, adult, [], new Set(['q_main_concern', 'q_red_flags']))).toBeNull();
  });

  it('hides warning signs the patient already ruled in or out, and skips the question when none are left', () => {
    const facts: FactMap = { ...adult, cough: { state: 'PRESENT' }, chest_pain: { state: 'ABSENT' } };
    const q = nextQuestion(demoBundle, facts, detectConcerns(demoBundle, facts), new Set());
    expect(q?.id).toBe('q_ws_cough');
    expect(presentQuestion(q!.question, facts).options?.map((o) => o.value)).toEqual(['breathless_severe', 'breathless', 'cough_blood', 'none']);
    const allKnown: FactMap = { ...facts, breathless_severe: { state: 'ABSENT' }, breathless: { state: 'ABSENT' }, cough_blood: { state: 'ABSENT' } };
    expect(nextQuestion(demoBundle, allKnown, detectConcerns(demoBundle, allKnown), new Set())?.id).toBe('q_duration');
  });

  it('does not re-ask facts the patient already volunteered', () => {
    const facts: FactMap = { ...adult, sore_throat: { state: 'PRESENT' }, duration_days: { state: 'PRESENT', value: 2 }, fever: { state: 'ABSENT' } };
    const q = nextQuestion(demoBundle, facts, detectConcerns(demoBundle, facts), new Set(['q_ws_throat']));
    expect(q?.id).toBe('q_cough');
  });

  it('asks conditional follow-ups only when their condition holds', () => {
    const base: FactMap = { ...adult, sore_throat: { state: 'PRESENT' }, duration_days: { state: 'PRESENT', value: 2 }, cough: { state: 'ABSENT' }, swollen_glands: { state: 'ABSENT' }, difficulty_swallowing: { state: 'ABSENT' } };
    const asked = new Set(['q_ws_throat']);
    const noFever = nextQuestion(demoBundle, { ...base, fever: { state: 'ABSENT' } }, detectConcerns(demoBundle, base), asked);
    expect(noFever?.id).toBe('q_runny_nose');
    const fever = nextQuestion(demoBundle, { ...base, fever: { state: 'PRESENT' } }, detectConcerns(demoBundle, base), asked);
    expect(fever?.id).toBe('q_temperature');
  });
});
