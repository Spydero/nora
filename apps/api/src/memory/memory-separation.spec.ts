import { guardConfirmed } from '../assessment/extraction/llm-extractor.js';
import { extractWithRules } from '../assessment/extraction/rule-extractor.js';
import { caseSummary, escalationResult, findings, relevantMemory } from '../assessment/graph/compose.js';
import { aboveLevelIssues, answerFacts, answerIssues, recommendationConflicts } from '../assessment/graph/consistency.js';
import { EvidenceRegistry } from '../assessment/graph/evidence-registry.js';
import { conflictNotice } from '../checks/assessment.worker.js';
import { demoBundle } from '../clinical/content/demo-bundle.js';
import { evaluateUrgency, type FactMap } from '../clinical/rules-engine.js';
import { historyFacts, namesFact } from './history-facts.js';
import type { MemoryItem } from './memory.types.js';

const P = { state: 'PRESENT' as const, source: 'answer' };
const A = { state: 'ABSENT' as const, source: 'answer' };

describe('profile history becomes background, not symptoms', () => {
  it('maps listed conditions and medicines to history facts by whole words', () => {
    const facts = historyFacts(demoBundle, { state: 'known', items: ['Mild asthma', 'Hypothyroidism'] }, { state: 'known', items: ['Levothyroxine 50 mcg', 'Warfarin'] });
    expect(facts.chronic_lung_disease).toEqual({ state: 'PRESENT', source: 'profile' });
    expect(facts.blood_thinners).toEqual({ state: 'PRESENT', source: 'profile' });
    expect(facts.diabetes).toEqual({ state: 'ABSENT', source: 'profile' });
    for (const [key, f] of Object.entries(facts)) expect(demoBundle.facts[key]!.kind, `${key}=${f.state}`).toBe('history');
  });

  it('treats unlisted history as unknown unless both lists are complete', () => {
    expect(historyFacts(demoBundle, { state: 'known', items: ['Mild asthma'] }, { state: 'unknown' }).diabetes).toBeUndefined();
    expect(historyFacts(demoBundle, { state: 'declined' }, { state: 'none' })).toEqual({});
    expect(Object.values(historyFacts(demoBundle, { state: 'none' }, { state: 'none' })).every((f) => f.state === 'ABSENT')).toBe(true);
  });

  it('does not match words inside other words', () => {
    expect(namesFact('Archival hives', ['hiv'])).toBe(false);
    expect(namesFact('HIV', ['hiv'])).toBe(true);
    expect(namesFact('Type 2 diabetes mellitus', ['diabetes'])).toBe(true);
  });

  it('keeps history out of the consultation’s symptom findings', () => {
    const facts: FactMap = { sore_throat: P, cough: A, chronic_lung_disease: { state: 'PRESENT', source: 'profile' }, age: { state: 'PRESENT', value: 30, source: 'profile' } };
    const f = findings(demoBundle, facts);
    expect(f.present.map((x) => x.key)).toEqual(['sore_throat']);
    expect(f.history?.present.map((x) => x.key)).toEqual(['chronic_lung_disease']);
  });

  it('extracts long-term conditions said in the past tense, but not past symptoms', () => {
    const obs = extractWithRules(demoBundle, 'I have had asthma since I was a child. I had a fever last month but not now. My throat hurts.');
    const keys = obs.filter((o) => o.state === 'PRESENT').map((o) => o.factKey);
    expect(keys).toContain('chronic_lung_disease');
    expect(keys).toContain('sore_throat');
    expect(keys).not.toContain('fever');
  });

  it('uses what the patient says now when it disagrees with their profile, and tells them to update it', () => {
    const profileSays: FactMap = { blood_thinners: { state: 'ABSENT', source: 'profile' } };
    const { observations, conflicts } = guardConfirmed(demoBundle, profileSays, [{ factKey: 'blood_thinners', state: 'PRESENT', quote: 'warfarin', assertion: 'affirmed', source: 'rules' }]);
    expect(observations.map((o) => o.factKey)).toContain('blood_thinners');
    expect(conflicts).toEqual([expect.objectContaining({ key: 'blood_thinners', resolution: 'treated_as_present', answeredIn: 'profile' })]);
    expect(conflictNotice(conflicts[0]!)).toMatch(/health profile.*update your profile/i);
  });

  it('says profile conditions came from the profile, not from the patient, when escalating', () => {
    const facts: FactMap = { headache: P, stiff_neck: P, chronic_lung_disease: { state: 'PRESENT', source: 'profile' } };
    const concerns = demoBundle.concerns.filter((c) => c.code === 'headache');
    const urgency = evaluateUrgency(demoBundle, facts, concerns);
    const result = escalationResult(demoBundle, facts, concerns, urgency, new EvidenceRegistry(), { number: '112', crisisLine: null });
    expect(result.summary).toMatch(/^You told Nora about headache and stiff neck\. Your health profile lists long-term lung condition/i);
    for (const r of urgency.triggered) expect(r.message).not.toMatch(/told Nora about:[^.]*lung/i);
  });
});

describe('earlier consultations stay separate', () => {
  const memory: MemoryItem[] = [
    { id: 'M1', kind: 'allergy', label: 'Allergy', text: 'Penicillin', recordedAt: null, href: '/settings' },
    { id: 'M2', kind: 'past_check', label: 'Earlier check', text: '1 Oct — Headache with fever and stiff neck.', recordedAt: '2026-10-01T09:00:00Z', href: '/history', checkId: 'old-headache', concernCode: 'headache' },
    { id: 'M3', kind: 'past_check', label: 'Earlier check', text: '5 Oct — Sore throat.', recordedAt: '2026-10-05T09:00:00Z', href: '/history', checkId: 'old-throat', concernCode: 'sore_throat' },
  ];

  it('only passes earlier checks for the same problem, or the one being followed up', () => {
    expect(relevantMemory(memory, ['sore_throat']).map((m) => m.id)).toEqual(['M1', 'M3']);
    expect(relevantMemory(memory, ['cough']).map((m) => m.id)).toEqual(['M1']);
    expect(relevantMemory(memory, ['cough'], 'old-headache').map((m) => m.id)).toEqual(['M1', 'M2']);
  });

  it('gives the AI this consultation’s symptoms separately from background and records', () => {
    const facts: FactMap = { sore_throat: P, fever: A, diabetes: { state: 'PRESENT', source: 'profile' }, recurrent: { state: 'PRESENT', source: 'memory' } };
    const s = caseSummary(demoBundle, facts, ['sore_throat'], null, relevantMemory(memory, ['sore_throat']));
    expect(s.thisConsultation).toEqual({ present: ['Sore throat'], absent: ['Fever'], unknown: [] });
    expect(s.healthBackground.present).toEqual(['Diabetes']);
    expect(JSON.stringify(s)).not.toMatch(/stiff neck/i);
  });

  it('rejects a draft that claims a symptom from an earlier check as current', () => {
    const answers = answerFacts(demoBundle, { sore_throat: P });
    expect(answerIssues(['You have a sore throat and a stiff neck.'], answers).join(' ')).toMatch(/Stiff neck.*haven't told Nora/);
    expect(answerIssues(['You have a sore throat. Earlier, you had a stiff neck with a headache.'], answers)).toEqual([]);
    expect(answerIssues(['You have a sore throat, which can cause a stiff neck feeling.'], answers)).toEqual([]);
    expect(answerIssues(['If you have a stiff neck, call 112.'], answers)).toEqual([]);
  });

  it('treats "not sure" as unreported, not as present', () => {
    const answers = answerFacts(demoBundle, { headache: P, stiff_neck: { state: 'UNKNOWN', source: 'answer' } });
    expect(answerIssues(['You have a headache and a stiff neck.'], answers).join(' ')).toMatch(/Stiff neck/);
  });
});

describe('contradictory recommendations', () => {
  it('flags wording stronger than the urgency, but not conditional advice', () => {
    expect(aboveLevelIssues(['Please call 112 now.'], 'soon')).toHaveLength(1);
    expect(aboveLevelIssues(['You should see a doctor today.'], 'routine')).toHaveLength(1);
    expect(aboveLevelIssues(['If it gets worse, call 112.'], 'soon')).toEqual([]);
    expect(aboveLevelIssues(['You should see a doctor today.'], 'urgent')).toEqual([]);
  });

  it('checks the whole result against its urgency', () => {
    const result = {
      urgency: { level: 'self_care' as const, title: '', text: '', reasons: [] },
      summary: 'You have a runny nose.',
      information: [{ code: 'x', title: 'x', text: 'This needs same-day care.', citations: [] }],
      carePlan: [{ id: 'w', kind: 'monitoring', text: 'Call 112 if you can’t breathe.', citations: [], watch: true }],
    };
    expect(recommendationConflicts(result).join(' ')).toMatch(/more urgent care/);
    expect(recommendationConflicts({ ...result, information: [] })).toEqual([]);
  });

  it('approved general information never sets its own timeframe', () => {
    const texts = demoBundle.concerns.flatMap((c) => c.information.map((i) => i.text));
    expect(texts.length).toBeGreaterThan(0);
    expect(aboveLevelIssues(texts, 'self_care')).toEqual([]);
  });
});
