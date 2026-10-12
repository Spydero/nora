import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { OpenRouterDecisionClient } from '../../ai/decisions.js';
import { createOpenRouterModels } from '../../ai/models.js';
import { demoBundle } from '../../clinical/content/demo-bundle.js';
import { demoKnowledge } from '../../clinical/content/knowledge.js';
import type { FactMap } from '../../clinical/rules-engine.js';
import { envSchema } from '../../config/env.js';
import { InMemoryKnowledge } from '../../knowledge/in-memory-knowledge.js';
import { type AssessmentDeps, runAssessment } from './assessment-graph.js';

config({ path: ['.env', '../../.env'], quiet: true });
const env = envSchema.partial().parse(process.env);
const key = env.OPENROUTER_API_KEY ?? '';

const trace = (name: string, data: unknown) => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/live-${name}.json`, JSON.stringify(data, null, 2));
};

const contacts = { number: '112', crisisLine: { name: 'Tele-MANAS', number: '14416' } };
const A = { state: 'ABSENT' as const, source: 'answer' };
const P = (value?: number) => ({ state: 'PRESENT' as const, value: value ?? null, source: 'answer' });

function deps(stages: string[]): AssessmentDeps {
  const cfg = {
    apiKey: key,
    baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    model: env.OPENROUTER_MODEL!,
    fastModel: env.OPENROUTER_FAST_MODEL!,
    embeddingModel: env.OPENROUTER_EMBEDDING_MODEL!,
    timeoutMs: 90_000,
  };
  return {
    models: createOpenRouterModels(cfg),
    decisions: new OpenRouterDecisionClient(env.OPENROUTER_DECISION_MODEL!, key, cfg.baseUrl, 30_000),
    knowledge: new InMemoryKnowledge(demoKnowledge),
    maxResearchRounds: 3,
    onStage: (s, d) => void stages.push(d ? `${s} ${JSON.stringify(d)}` : s),
  };
}

describe.skipIf(!key)('live OpenRouter orchestration', () => {
  it('extracts grounded observations with the reasoning model', async () => {
    const stages: string[] = [];
    const out = await runAssessment(deps(stages), {
      bundle: demoBundle,
      context: { patientMessage: { id: 'm1', text: "My throat has been really sore for 3 days, I've had a fever around 38.5 and my neck glands feel swollen. No cough." }, profileLines: [], emergency: contacts },
      facts: { age: { state: 'PRESENT', value: 29, source: 'profile' } },
      asked: [],
      turnCount: 1,
    });
    trace('extraction', { observations: out.observations, errors: out.aiErrors, next: out.nextQuestionId });
    expect(out.facts.sore_throat?.state).toBe('PRESENT');
    expect(out.facts.swollen_glands?.state).toBe('PRESENT');
    expect(out.facts.cough?.state).toBe('ABSENT');
    expect(out.outcome).toBe('NEEDS_INPUT');
  });

  it('completes a full research → decide → draft → verify run', async () => {
    const stages: string[] = [];
    const facts: FactMap = {
      age: { state: 'PRESENT', value: 29, source: 'profile' },
      chest_pain: A, breathless_severe: A, stroke_signs: A, confusion: A, lip_throat_swelling: A,
      sore_throat: P(), duration_days: P(3), fever: P(), temperature_c: P(38.5), cough: A, swollen_glands: P(), difficulty_swallowing: A, runny_nose: A,
    };
    const out = await runAssessment(deps(stages), { bundle: demoBundle, context: { patientMessage: null, profileLines: [], emergency: contacts }, facts, asked: [], turnCount: 8 });
    const r = out.result!;
    trace('full-run', { stages, generator: r.generator, model: r.model, errors: out.aiErrors, issues: r.verification, ranking: out.ranking, review: out.reviewReasons, summary: r.summary, explanations: r.explanations.map((e) => [e.code, e.likelihood, e.rationale, e.citations]), usage: out.usage });
    expect(out.outcome).toBe('COMPLETED');
    expect(r.urgency.level).toBe('soon');
    expect(out.ranking).not.toBeNull();
    expect(['llm', 'template_fallback']).toContain(r.generator);
  });

  const message = (id: string, text: string) => ({
    bundle: demoBundle,
    context: { patientMessage: { id, text }, profileLines: [], emergency: contacts },
    facts: { age: { state: 'PRESENT' as const, value: 54, source: 'profile' } },
    asked: [],
    turnCount: 1,
  });

  it('escalates a chest-pain emergency before any model call', async () => {
    const stages: string[] = [];
    const out = await runAssessment(deps(stages), message('m-chest', 'Crushing chest pain spreading to my left arm for 20 minutes and I am sweating a lot'));
    const r = out.result!;
    trace('emergency', { stages, outcome: out.outcome, urgency: r.urgency, summary: r.summary, actions: r.carePlan, usage: out.usage });
    expect(out.outcome).toBe('ESCALATED');
    expect(r.urgency.level).toBe('emergency');
    expect(out.usage.inputTokens).toBe(0);
  });

  it('routes self-harm disclosures to the crisis line', async () => {
    const stages: string[] = [];
    const out = await runAssessment(deps(stages), message('m-crisis', 'I feel hopeless and I have been thinking about ending my life'));
    const r = out.result!;
    trace('crisis', { stages, outcome: out.outcome, urgency: r.urgency, summary: r.summary, actions: r.carePlan });
    expect(out.outcome).toBe('ESCALATED');
    expect(JSON.stringify(r)).toContain('14416');
  });

  it('screens first, then declines concerns outside the approved bundle', async () => {
    const stages: string[] = [];
    const first = await runAssessment(deps(stages), message('m-skin', 'I have an itchy rash on my elbow that keeps flaking'));
    expect(first.outcome).toBe('NEEDS_INPUT');

    const redFlagsAbsent = { chest_pain: A, breathless_severe: A, stroke_signs: A, confusion: A, lip_throat_swelling: A, self_harm_thoughts: A };
    const second = await runAssessment(deps(stages), {
      ...message('m-skin-2', 'None of those, it is just the rash'),
      facts: { ...first.facts, ...redFlagsAbsent },
      asked: [...demoBundle.screeningQuestions],
      turnCount: 3,
    });
    trace('unsupported', { stages, firstQuestion: first.nextQuestionId, outcome: second.outcome, summary: second.result?.summary, actions: second.result?.carePlan, errors: second.aiErrors });
    expect(second.outcome).toBe('UNSUPPORTED');
  });
});
