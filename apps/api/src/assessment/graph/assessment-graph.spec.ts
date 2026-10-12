import { AIMessage } from '@langchain/core/messages';
import { type DecisionAnswer, ScriptedDecisions } from '../../ai/decisions.js';
import { ScriptedChatModel } from '../../ai/scripted-chat-model.js';
import { demoBundle } from '../../clinical/content/demo-bundle.js';
import { demoKnowledge } from '../../clinical/content/knowledge.js';
import type { FactMap } from '../../clinical/rules-engine.js';
import { InMemoryKnowledge } from '../../knowledge/in-memory-knowledge.js';
import type { MemoryItem } from '../../memory/memory.types.js';
import { mergeObservations } from '../extraction/llm-extractor.js';
import { type AssessmentDeps, type AssessmentInput, runAssessment } from './assessment-graph.js';
import { RESEARCH_TOOL_NAMES } from './tools.js';

const contacts = { number: '112', crisisLine: { name: 'Tele-MANAS', number: '14416' } };
const P = (value?: number) => ({ state: 'PRESENT' as const, value: value ?? null, source: 'answer' });
const A = { state: 'ABSENT' as const, source: 'answer' };

const noRedFlags: FactMap = { chest_pain: A, breathless_severe: A, stroke_signs: A, confusion: A, lip_throat_swelling: A, drooling: A };

/** Sore throat with fever, glands and no cough: every question answered, rules say "soon". */
const strepCase: FactMap = {
  ...noRedFlags,
  sore_throat: P(),
  duration_days: P(3),
  fever: P(),
  temperature_c: P(38.4),
  cough: A,
  swollen_glands: P(),
  difficulty_swallowing: A,
  runny_nose: A,
};

function input(facts: FactMap, opts: { message?: string; asked?: string[]; turnCount?: number; age?: number } = {}): AssessmentInput {
  return {
    bundle: demoBundle,
    context: { patientMessage: opts.message ? { id: 'm1', text: opts.message } : null, memory: [], emergency: contacts },
    facts: { age: { state: 'PRESENT', value: opts.age ?? 30, source: 'profile' }, ...facts },
    asked: opts.asked ?? [],
    turnCount: opts.turnCount ?? 1,
  };
}

function setup(opts: { chat?: (AIMessage | Error)[]; drafts?: (Record<string, unknown> | Error)[]; extraction?: (Record<string, unknown> | Error)[]; decisions?: (Record<string, DecisionAnswer> | Error)[]; rounds?: number; ai?: boolean } = {}) {
  const chat = new ScriptedChatModel(opts.chat ?? [], opts.drafts ?? []);
  const fast = new ScriptedChatModel([], opts.extraction ?? []);
  const decisions = new ScriptedDecisions(opts.decisions ?? []);
  const knowledge = new InMemoryKnowledge(demoKnowledge);
  const stages: string[] = [];
  const ai = opts.ai ?? true;
  const deps: AssessmentDeps = {
    models: ai ? { chat, fast, chatName: 'scripted-chat', fastName: 'scripted-fast' } : null,
    decisions: ai ? decisions : null,
    knowledge,
    maxResearchRounds: opts.rounds ?? 3,
    onStage: (s) => void stages.push(s),
  };
  return { chat, fast, decisions, knowledge, stages, deps };
}

const toolCall = (name: string, args: Record<string, unknown>, id = `call_${name}_${Math.random().toString(36).slice(2, 6)}`) =>
  new AIMessage({ content: '', tool_calls: [{ id, name, args, type: 'tool_call' }] });

const ranking: Record<string, DecisionAnswer> = {
  best_explanation: { type: 'choice', choice: 'bacterial_pharyngitis', probabilities: { viral_pharyngitis: 0.1, bacterial_pharyngitis: 0.9 }, confidence: 0.8 },
  needs_emergency_care: { type: 'noul', noul: 0.05 },
};

const goodDraft = {
  summary: 'You described a sore throat with fever and swollen neck glands for three days. A clinician should check this within the next 24–48 hours.',
  explanations: [
    { code: 'viral_pharyngitis', likelihood: 'possible', rationale: 'Viral throat infections usually come with a cough or runny nose, which you do not have.', citations: ['E1'] },
    { code: 'bacterial_pharyngitis', likelihood: 'possible', rationale: 'Fever and swollen glands without a cough can fit a bacterial throat infection.', citations: ['E1'] },
  ],
  questionsForClinician: ['Do I need a throat swab?'],
  memoryRefs: [],
};

describe('assessment graph orchestration', () => {
  it('runs research tools, calibrated ranking, drafting and verification end to end', async () => {
    const { chat, decisions, knowledge, stages, deps } = setup({
      chat: [
        toolCall('search_knowledge', { query: 'bacterial throat infection fever swollen glands' }),
        toolCall('get_case_summary', {}),
        new AIMessage('I have enough approved evidence.'),
      ],
      drafts: [goodDraft],
      decisions: [ranking],
    });

    const out = await runAssessment(deps, input(strepCase));

    expect(out.outcome).toBe('COMPLETED');
    expect(chat.boundTools).toEqual([...RESEARCH_TOOL_NAMES]);
    expect(chat.calls).toHaveLength(3);
    expect(knowledge.searches).toContain('bacterial throat infection fever swollen glands');
    expect(decisions.calls).toHaveLength(1);
    expect(decisions.calls[0]!.questions.best_explanation).toMatchObject({ type: 'choice' });
    expect(JSON.stringify(decisions.calls[0]!.state)).not.toContain('urgency');

    const r = out.result!;
    expect(r.generator).toBe('llm');
    expect(r.urgency.level).toBe('soon');
    expect(r.urgency.reasons.map((x) => x.ruleId)).toContain('r_strep_features');
    expect(r.explanations.map((e) => [e.code, e.likelihood])).toEqual([
      ['bacterial_pharyngitis', 'more_likely'],
      ['viral_pharyngitis', 'less_likely'],
    ]);
    const ids = new Set(r.evidence.map((e) => e.citationId));
    for (const e of r.explanations) for (const c of e.citations) expect(ids.has(c)).toBe(true);
    for (const item of r.carePlan) expect(item.citations.length).toBeGreaterThan(0);
    expect(r.questionsForClinician).toEqual(['Do I need a throat swab?']);
    expect(r.verification).toEqual({ passed: true, attempts: 1, issues: [] });
    expect(stages).toEqual(expect.arrayContaining(['checking_safety', 'researching', 'searching_knowledge', 'ranking_explanations', 'drafting', 'verifying', 'finalizing']));
    expect(out.usage.inputTokens).toBeGreaterThan(0);
  });

  it('escalates emergencies from the message without calling any model', async () => {
    const { chat, fast, decisions, deps } = setup();
    const out = await runAssessment(deps, input({}, { message: 'I have a cough and crushing chest pain since an hour' }));

    expect(out.outcome).toBe('ESCALATED');
    expect(fast.structuredCalls).toHaveLength(0);
    expect(chat.calls).toHaveLength(0);
    expect(decisions.calls).toHaveLength(0);
    expect(out.result!.status).toBe('ESCALATED');
    expect(out.result!.carePlan[0]!.id).toBe('ci_call_112');
    expect(out.result!.summary).toContain('chest pain or pressure');
    expect(out.result!.summary).not.toContain(out.result!.urgency.reasons[0]!.message);
    expect(out.result!.limitations).toEqual([]);
    expect(out.result!.evidence.length).toBeGreaterThan(0);
  });

  it('routes self-harm disclosures to crisis support', async () => {
    const { deps } = setup({ ai: false });
    const out = await runAssessment(deps, input({ headache: P() }, { message: 'honestly I want to end my life' }));
    expect(out.outcome).toBe('ESCALATED');
    expect(out.result!.carePlan.map((c) => c.id)).toEqual(['ci_call_112', 'ci_crisis']);
  });

  it('grounds LLM extraction in the patient’s words and asks the next question', async () => {
    const { fast, deps } = setup({
      extraction: [
        {
          observations: [
            { factKey: 'sore_throat', state: 'PRESENT', value: null, quote: 'my throat has been killing me', assertion: 'affirmed' },
            { factKey: 'chest_pain', state: 'PRESENT', value: null, quote: 'my chest feels tight', assertion: 'affirmed' },
            { factKey: 'fever', state: 'PRESENT', value: null, quote: 'had a fever as a kid', assertion: 'historical' },
          ],
        },
      ],
    });
    const out = await runAssessment(deps, input({}, { message: 'my throat has been killing me for 2 days' }));

    expect(fast.structuredCalls).toHaveLength(1);
    expect(out.outcome).toBe('NEEDS_INPUT');
    expect(out.nextQuestionId).toBe('q_ws_throat');
    expect(out.facts.sore_throat).toMatchObject({ state: 'PRESENT', source: 'llm' });
    expect(out.facts.duration_days).toMatchObject({ value: 2, source: 'rules' });
    expect(out.facts).not.toHaveProperty('chest_pain');
    expect(out.facts).not.toHaveProperty('fever');
  });

  it('never lets the model drop a critical red flag the rules saw', () => {
    const merged = mergeObservations(
      demoBundle,
      [{ factKey: 'stiff_neck', state: 'PRESENT', quote: 'stiff neck', assertion: 'affirmed', source: 'rules' }],
      [{ factKey: 'stiff_neck', state: 'ABSENT', quote: 'stiff neck', assertion: 'negated', source: 'llm' }],
    );
    expect(merged).toEqual([expect.objectContaining({ factKey: 'stiff_neck', state: 'PRESENT', source: 'rules' })]);
  });

  it('retries a draft that cites evidence it never retrieved', async () => {
    const bad = { ...goodDraft, explanations: [{ ...goodDraft.explanations[1]!, citations: ['E99'] }] };
    const { chat, deps } = setup({ chat: [new AIMessage('Evidence is in the case already.')], drafts: [bad, goodDraft], decisions: [ranking] });
    const out = await runAssessment(deps, input(strepCase));

    expect(out.outcome).toBe('COMPLETED');
    expect(out.result!.generator).toBe('llm');
    expect(out.result!.verification.attempts).toBe(2);
    expect(chat.structuredCalls).toHaveLength(2);
    expect(JSON.stringify(chat.structuredCalls[1]!.input)).toContain('E99 was not retrieved');
  });

  it('falls back to approved template content when drafts keep diagnosing or dosing', async () => {
    const unsafe = {
      summary: 'You have strep throat. Take 500 mg amoxicillin twice a day and there is no need to see a doctor.',
      explanations: [{ code: 'bacterial_pharyngitis', likelihood: 'more_likely', rationale: 'Classic strep.', citations: ['E1'] }],
      questionsForClinician: [],
      memoryRefs: [],
    };
    const { deps } = setup({ chat: [new AIMessage('ok')], drafts: [unsafe, unsafe], decisions: [ranking] });
    const out = await runAssessment(deps, input(strepCase));
    const r = out.result!;

    expect(out.outcome).toBe('COMPLETED');
    expect(r.generator).toBe('template_fallback');
    expect(r.urgency.level).toBe('soon');
    expect(r.summary).not.toMatch(/amoxicillin|500 mg/);
    expect(r.verification.passed).toBe(false);
    expect(r.verification.issues.join(' ')).toMatch(/Diagnostic language|dosing|contradicts/);
    expect(out.reviewReasons).toContain('ai_draft_failed_verification');
  });

  it('keeps working when the model provider is down', async () => {
    const { deps } = setup({ chat: [new Error('429 rate limited')], decisions: [new Error('decision timeout')] });
    const out = await runAssessment(deps, input(strepCase));

    expect(out.outcome).toBe('COMPLETED');
    expect(out.result!.generator).toBe('template_fallback');
    expect(out.aiErrors.join(' ')).toMatch(/research: 429/);
    expect(out.result!.carePlan.length).toBeGreaterThan(0);
  });

  it('bounds the research loop', async () => {
    const { chat, deps } = setup({
      chat: Array.from({ length: 6 }, (_, i) => toolCall('search_knowledge', { query: `throat ${i}` })),
      drafts: [goodDraft],
      decisions: [ranking],
      rounds: 2,
    });
    const out = await runAssessment(deps, input(strepCase));
    expect(chat.calls).toHaveLength(2);
    expect(chat.pendingReplies).toBe(4);
    expect(out.outcome).toBe('COMPLETED');
  });

  it('flags a case for clinician review when the decision model disagrees, without lowering urgency', async () => {
    const { deps } = setup({
      chat: [new AIMessage('ok')],
      drafts: [goodDraft],
      decisions: [{ ...ranking, needs_emergency_care: { type: 'noul', noul: 0.92 } }],
    });
    const out = await runAssessment(deps, input(strepCase));
    expect(out.reviewReasons).toContain('decision_model_flagged_possible_emergency');
    expect(out.result!.urgency.level).toBe('soon');
    expect(out.result!.limitations.join(' ')).toContain('112');
  });

  it('runs fully in template mode without any model', async () => {
    const { deps } = setup({ ai: false });
    const out = await runAssessment(deps, input(strepCase));
    const r = out.result!;
    expect(out.outcome).toBe('COMPLETED');
    expect(r.generator).toBe('template');
    expect(r.model).toBeNull();
    expect(r.explanations[0]!.code).toBe('bacterial_pharyngitis');
    for (const e of r.explanations) expect(e.citations.length).toBeGreaterThan(0);
    expect(r.limitations.join(' ')).toContain('switched off');
  });

  it('marks results incomplete when critical questions were skipped', async () => {
    const { deps } = setup({ ai: false });
    const out = await runAssessment(deps, input({ ...strepCase, fever: { state: 'UNKNOWN', source: 'answer' }, temperature_c: { state: 'NOT_ASKED' } }, { turnCount: demoBundle.meta.maxTurns }));
    expect(out.outcome).toBe('INCOMPLETE');
    expect(out.result!.missingInformation.map((m) => m.key)).toContain('fever');
  });

  it('applies scope rules after safety rules', async () => {
    const { deps } = setup({ ai: false });
    const minor = await runAssessment(deps, input({ ...noRedFlags, cough: P() }, { age: 15 }));
    expect(minor.outcome).toBe('UNSUPPORTED');
    expect(minor.result!.summary).toContain('18');

    const minorEmergency = await runAssessment(setup({ ai: false }).deps, input({ cough: P(), chest_pain: P() }, { age: 15 }));
    expect(minorEmergency.outcome).toBe('ESCALATED');
  });

  describe('memory', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const memory: MemoryItem[] = [
      { id: 'M1', kind: 'allergy', label: 'Allergy', text: 'Penicillin', recordedAt: '2026-01-01T00:00:00Z', href: '/settings' },
      { id: 'M2', kind: 'medicine', label: 'Current medicine', text: 'Levothyroxine', recordedAt: '2026-01-01T00:00:00Z', href: '/settings' },
      { id: 'M3', kind: 'past_check', label: 'Earlier check', text: '2 Oct 2026 — Sore throat.', recordedAt: '2026-10-02T09:00:00Z', href: '/history', checkId: 'c0', concernCode: 'sore_throat', urgency: 'self_care' },
    ];
    const withMemory = (facts: FactMap, m = memory): AssessmentInput => ({ ...input(facts), context: { ...input(facts).context, memory: m, now } });

    it('flags a recent check for the same concern without treating it as a current symptom', async () => {
      const out = await runAssessment(setup({ ai: false }).deps, withMemory(strepCase));
      expect(out.facts.recurrent).toMatchObject({ state: 'PRESENT', source: 'memory' });
      expect(out.urgency!.triggered.map((t) => t.ruleId)).toContain('r_recurrent');
      expect(out.result!.findings.present.map((f) => f.key)).not.toContain('recurrent');
    });

    it('ignores past checks outside the recurrence window or for other concerns', async () => {
      const old = [{ ...memory[2]!, recordedAt: '2026-08-01T09:00:00Z' }];
      const other = [{ ...memory[2]!, concernCode: 'headache' }];
      for (const m of [old, other]) expect((await runAssessment(setup({ ai: false }).deps, withMemory(strepCase, m))).facts.recurrent).toBeUndefined();
    });

    it('adds questions from confirmed allergies and medicines, citing their memory IDs', async () => {
      const r = (await runAssessment(setup({ ai: false }).deps, withMemory(strepCase))).result!;
      expect(r.questionsForClinician.join(' ')).toMatch(/Penicillin allergy/);
      expect(r.questionsForClinician.join(' ')).toMatch(/Levothyroxine/);
      expect(r.memory!.filter((m) => m.used).map((m) => m.id)).toEqual(['M1', 'M2']);
    });

    it('rejects an AI draft that invents history, then falls back to approved content', async () => {
      const invented = { ...goodDraft, summary: 'You take metformin for diabetes, and your sore throat keeps coming back. A clinician should check this within 24–48 hours.' };
      const { deps } = setup({ chat: [new AIMessage('ok')], drafts: [invented, invented], decisions: [ranking] });
      const out = await runAssessment({ ...deps, watchTerms: ['metformin', 'diabetes', 'penicillin'] }, withMemory(strepCase));
      expect(out.result!.generator).toBe('template_fallback');
      expect(out.result!.verification.issues.join(' ')).toMatch(/without citing a memory item|"metformin"/);
      expect(out.result!.summary).not.toMatch(/metformin|diabetes/);
    });
  });

  describe('safety over AI conclusions', () => {
    const viralCase: FactMap = { ...noRedFlags, sore_throat: P(), runny_nose: P(), cough: P(), fever: A, duration_days: P(2), difficulty_swallowing: A, swollen_glands: A };
    const unsafe = { ...goodDraft, summary: 'You have strep throat. Take 500 mg amoxicillin twice a day.' };

    it('does not fall back to self-care when the AI explanation fails verification', async () => {
      const { deps } = setup({ chat: [new AIMessage('ok')], drafts: [unsafe, unsafe], decisions: [ranking] });
      const out = await runAssessment(deps, input(viralCase, { turnCount: demoBundle.meta.maxTurns }));
      const r = out.result!;
      expect(r.generator).toBe('template_fallback');
      expect(r.urgency.level).toBe('routine');
      expect(r.urgency.reasons.map((x) => x.ruleId)).toContain('unverified_explanation');
      expect(r.handoff.recommended).toBe(true);
      expect(out.urgency!.level).toBe('routine');
      expect(out.reviewReasons).toContain('ai_draft_failed_verification');
    });

    it('keeps self-care when the AI is simply unavailable, and fails over on drafting errors', async () => {
      const { deps } = setup({ chat: [new AIMessage('ok')], drafts: [new Error('503 overloaded'), new Error('503 overloaded')], decisions: [ranking] });
      const out = await runAssessment(deps, input(viralCase, { turnCount: demoBundle.meta.maxTurns }));
      expect(out.result!.generator).toBe('template_fallback');
      expect(out.result!.urgency.level).toBe('self_care');
      expect(out.aiErrors.join(' ')).toMatch(/draft: 503/);
      expect(out.reviewReasons).not.toContain('ai_draft_failed_verification');
    });

    it('rejects a draft that contradicts the patient’s answers or plays down warning signs', async () => {
      const contradicting = {
        ...goodDraft,
        summary: 'You have a sore throat with no fever, which usually settles on its own. Your temperature was 37.2 °C.',
      };
      const { chat, deps } = setup({ chat: [new AIMessage('ok')], drafts: [contradicting, goodDraft], decisions: [ranking] });
      const out = await runAssessment(deps, input(strepCase));
      expect(out.result!.generator).toBe('llm');
      const feedback = JSON.stringify(chat.structuredCalls[1]!.input);
      expect(feedback).toContain('you said you do');
      expect(feedback).toContain('Suggests less care');
      expect(feedback).toContain('37.2');
    });

    it('offers home care only as comfort until the patient is seen, and qualifies reassuring explanations', async () => {
      const r = (await runAssessment(setup({ ai: false }).deps, input(strepCase))).result!;
      expect(r.urgency.level).toBe('soon');
      const selfCare = r.carePlan.filter((i) => i.kind === 'self_care');
      expect(selfCare.length).toBeGreaterThan(0);
      for (const i of selfCare) expect(i.whileWaiting).toBe(true);
      expect(r.explanations.find((e) => e.code === 'viral_pharyngitis')!.caution).toMatch(/warning signs/);
      expect(r.summary).not.toMatch(/next step|not a diagnosis/i);
    });

    it('drops home care once the patient needs a doctor today', async () => {
      const r = (await runAssessment(setup({ ai: false }).deps, input({ ...strepCase, temperature_c: P(39.8) }))).result!;
      expect(r.urgency.level).toBe('urgent');
      expect(r.carePlan.some((i) => i.kind === 'self_care')).toBe(false);
    });

    it('keeps a confirmed answer when a later message disagrees, and says so', async () => {
      const out = await runAssessment(setup({ ai: false }).deps, input({ ...strepCase, cough: A }, { message: 'I have a cough as well' }));
      expect(out.facts.cough).toMatchObject({ state: 'ABSENT', source: 'answer' });
      expect(out.conflicts).toEqual([{ key: 'cough', label: 'Cough', answered: 'no', mentioned: 'yes', resolution: 'kept_answer' }]);
      expect(out.result!.answerConflicts).toEqual(out.conflicts);
    });

    it('treats a warning sign mentioned after a "no" as present, and reports it', async () => {
      const out = await runAssessment(setup({ ai: false }).deps, input({ ...viralCase, stiff_neck: A }, { message: 'now I have a stiff neck too' }));
      expect(out.facts.stiff_neck).toMatchObject({ state: 'PRESENT' });
      expect(out.conflicts[0]).toMatchObject({ key: 'stiff_neck', resolution: 'treated_as_present' });
      expect(out.urgency!.triggered.map((t) => t.ruleId)).toContain('warning_sign:stiff_neck');
      expect(out.urgency!.level).toBe('soon');
    });
  });

  it('screens red flags before turning away an unsupported concern', async () => {
    const asked = ['q_main_concern'];
    const first = await runAssessment(setup({ ai: false }).deps, input({}, { asked }));
    expect(first.nextQuestionId).toBe('q_red_flags');
    const second = await runAssessment(setup({ ai: false }).deps, input(noRedFlags, { asked: [...asked, 'q_red_flags'] }));
    expect(second.outcome).toBe('UNSUPPORTED');
  });
});
