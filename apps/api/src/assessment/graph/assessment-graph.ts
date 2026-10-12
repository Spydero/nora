import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { Annotation, END, START, StateGraph, messagesStateReducer } from '@langchain/langgraph';
import { z } from 'zod';
import type { DecisionPort } from '../../ai/decisions.js';
import type { ModelSet } from '../../ai/models.js';
import type { BundleContent } from '../../clinical/bundle.schema.js';
import {
  checkScope,
  detectConcerns,
  evaluateUrgency,
  type FactMap,
  missingRequiredFacts,
  nextQuestion,
  type ScopeOutcome,
  type UrgencyOutcome,
} from '../../clinical/rules-engine.js';
import type { KnowledgePort } from '../../knowledge/knowledge.port.js';
import { applyObservations, extractWithModel, mergeObservations, type TokenUsage, usageOf } from '../extraction/llm-extractor.js';
import { extractWithRules, type Observation } from '../extraction/rule-extractor.js';
import type { EvidenceRef, Generator, ResultContent } from '../result.types.js';
import {
  buildResult,
  caseSummary,
  concernDefs,
  type EmergencyContacts,
  escalationResult,
  recordQuestions,
  recurrence,
  templateDraft,
  unsupportedResult,
} from './compose.js';
import type { MemoryItem } from '../../memory/memory.types.js';
import { EvidenceRegistry } from './evidence-registry.js';
import { DRAFT_SYSTEM, RESEARCH_SYSTEM } from './prompts.js';
import { createResearchTools } from './tools.js';
import { type Draft, verifyDraft } from './verify.js';

export const MAX_DRAFT_ATTEMPTS = 2;
/** Decision-model probability above which a non-emergency case is flagged for clinician review. */
export const DECISION_REVIEW_THRESHOLD = 0.7;

export type Outcome = 'NEEDS_INPUT' | 'COMPLETED' | 'INCOMPLETE' | 'ESCALATED' | 'UNSUPPORTED';

export interface CaseContext {
  patientMessage: { id: string; text: string } | null;
  /** Confirmed records only; see MemoryService. */
  memory: MemoryItem[];
  emergency: EmergencyContacts;
  /** The check this one deliberately follows up; it does not count as a recurrence. */
  parentCheckId?: string | null;
  now?: Date;
}

export interface AssessmentDeps {
  models: ModelSet | null;
  decisions: DecisionPort | null;
  knowledge: KnowledgePort;
  maxResearchRounds: number;
  /** AI is enabled for the tenant but the provider is temporarily unavailable. */
  aiPaused?: boolean;
  /** Medicine and condition names a draft may only use when memory or evidence mentions them. */
  watchTerms?: readonly string[];
  onStage?: (stage: string, detail?: Record<string, unknown>) => void | Promise<void>;
}

const last = <T>() => Annotation<T>({ reducer: (_a: T, b: T) => b });

const State = Annotation.Root({
  bundle: last<BundleContent>(),
  context: last<CaseContext>(),
  facts: Annotation<FactMap>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  observations: Annotation<Observation[]>({ reducer: (_a, b) => b, default: () => [] }),
  asked: last<string[]>(),
  turnCount: last<number>(),
  concerns: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  urgency: Annotation<UrgencyOutcome | null>({ reducer: (_a, b) => b, default: () => null }),
  scope: Annotation<ScopeOutcome | null>({ reducer: (_a, b) => b, default: () => null }),
  nextQuestionId: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  researchRounds: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  evidence: Annotation<EvidenceRef[]>({ reducer: (_a, b) => b, default: () => [] }),
  ranking: Annotation<Record<string, number> | null>({ reducer: (_a, b) => b, default: () => null }),
  reviewReasons: Annotation<string[]>({ reducer: (a, b) => [...new Set([...a, ...b])], default: () => [] }),
  draft: Annotation<Draft | null>({ reducer: (_a, b) => b, default: () => null }),
  draftAttempts: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  issues: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  generator: Annotation<Generator>({ reducer: (_a, b) => b, default: () => 'template' }),
  aiErrors: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  usage: Annotation<TokenUsage>({
    reducer: (a, b) => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }),
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),
  outcome: Annotation<Outcome | null>({ reducer: (_a, b) => b, default: () => null }),
  result: Annotation<ResultContent | null>({ reducer: (_a, b) => b, default: () => null }),
});

export type AssessmentState = typeof State.State;
export type AssessmentInput = Pick<AssessmentState, 'bundle' | 'context' | 'facts' | 'asked' | 'turnCount'>;
type Update = typeof State.Update;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function draftSchema(codes: [string, ...string[]]) {
  return z.object({
    summary: z.string().min(20).max(1200).describe('2–4 sentence plain-language summary of the case and the required next step'),
    explanations: z
      .array(
        z.object({
          code: z.enum(codes),
          likelihood: z.enum(['more_likely', 'possible', 'less_likely']),
          rationale: z.string().max(600).describe('Why this candidate fits or does not fit the facts'),
          citations: z.array(z.string()).min(1).max(4).describe('Evidence IDs such as "E1"'),
        }),
      )
      .min(1)
      .max(codes.length),
    questionsForClinician: z.array(z.string().max(200)).max(4),
    memoryRefs: z.array(z.string()).max(8).describe('IDs of memory items (like "M2") the text relies on; empty if none'),
  });
}

/**
 * Builds the per-run assessment graph. Deterministic nodes own urgency, scope
 * and question selection; model-backed nodes only research, rank approved
 * candidates and write explanations, and every draft is verified.
 */
export function buildAssessmentGraph(deps: AssessmentDeps) {
  const registry = new EvidenceRegistry();
  const stage = async (name: string, detail?: Record<string, unknown>) => deps.onStage?.(name, detail);
  let current: AssessmentState;

  const tools = createResearchTools({
    knowledge: deps.knowledge,
    registry,
    concernCodes: () => current.concerns,
    allowedSourceKeys: () => [...new Set(concernDefs(current.bundle, current.concerns).flatMap((c) => c.sourceKeys).concat(['src_red_flags', 'src_self_care_general']))],
    caseSummary: () => caseSummary(current.bundle, current.facts, current.concerns, current.urgency, current.context.memory),
    onSearch: (query) => stage('searching_knowledge', { query }),
  });
  const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t as StructuredToolInterface]));

  const extract = async (s: AssessmentState): Promise<Update> => {
    if (!s.context.patientMessage) return {};
    await stage('extracting');
    const text = s.context.patientMessage.text;
    const rules = extractWithRules(s.bundle, text);
    const ruleFacts = { ...s.facts, ...applyObservations(s.bundle, s.facts, rules) };
    const quick = evaluateUrgency(s.bundle, ruleFacts, detectConcerns(s.bundle, ruleFacts));
    if (quick.level === 'emergency' || !deps.models) {
      return { observations: rules, facts: applyObservations(s.bundle, s.facts, rules) };
    }
    try {
      const llm = await extractWithModel(deps.models.fast, s.bundle, text);
      const merged = mergeObservations(s.bundle, rules, llm.observations);
      return { observations: merged, facts: applyObservations(s.bundle, s.facts, merged), usage: llm.usage };
    } catch (e) {
      return { observations: rules, facts: applyObservations(s.bundle, s.facts, rules), aiErrors: [`extraction: ${errorText(e)}`] };
    }
  };

  const triage = async (s: AssessmentState): Promise<Update> => {
    await stage('checking_safety');
    const concerns = detectConcerns(s.bundle, s.facts);
    const codes = concerns.map((c) => c.code);
    const facts: FactMap = { ...s.facts };
    const earlier = s.context.memory.filter((m) => !m.checkId || m.checkId !== s.context.parentCheckId);
    if (s.bundle.facts.recurrent && !facts.recurrent && recurrence(s.bundle, codes, earlier, s.context.now ?? new Date())) {
      facts.recurrent = { state: 'PRESENT', source: 'memory' };
    }
    return {
      concerns: codes,
      facts,
      urgency: evaluateUrgency(s.bundle, facts, concerns),
      scope: checkScope(s.bundle, facts, concerns),
    };
  };

  const escalate = async (s: AssessmentState): Promise<Update> => {
    await stage('escalating');
    const urgency = s.urgency!;
    const keys = urgency.triggered.filter((t) => t.level === 'emergency').map((t) => t.sourceKey);
    for (const chunk of await deps.knowledge.bySourceKeys([...new Set(keys)], 1)) registry.add(chunk);
    const result = escalationResult(s.bundle, s.facts, concernDefs(s.bundle, s.concerns), urgency, registry, s.context.emergency, s.context.memory);
    return { outcome: 'ESCALATED', result, evidence: registry.list(), generator: 'rules' };
  };

  const unsupported = async (s: AssessmentState): Promise<Update> => {
    for (const chunk of await deps.knowledge.bySourceKeys(['src_self_care_general'], 1)) registry.add(chunk);
    const message = s.scope?.message ?? 'Nora cannot assess this concern yet. Please speak with a doctor.';
    const result = unsupportedResult(s.bundle, s.facts, s.urgency!, message, registry, s.context.emergency, s.context.memory);
    return { outcome: 'UNSUPPORTED', result, evidence: registry.list(), generator: 'rules' };
  };

  const selectQuestion = async (s: AssessmentState): Promise<Update> => {
    const q = nextQuestion(s.bundle, s.facts, concernDefs(s.bundle, s.concerns), new Set(s.asked));
    if (q && s.turnCount < s.bundle.meta.maxTurns) return { nextQuestionId: q.id, outcome: 'NEEDS_INPUT' };
    return { nextQuestionId: null };
  };

  const research = async (s: AssessmentState): Promise<Update> => {
    current = s;
    await stage('researching', { round: s.researchRounds + 1 });
    const brief = s.messages.length
      ? []
      : [new HumanMessage(`Gather approved evidence for this case.\n${JSON.stringify(caseSummary(s.bundle, s.facts, s.concerns, s.urgency, s.context.memory))}`)];
    try {
      const model = deps.models!.chat.bindTools!(tools);
      const ai = (await model.invoke([new SystemMessage(RESEARCH_SYSTEM), ...s.messages, ...brief])) as AIMessage;
      return { messages: [...brief, ai], researchRounds: s.researchRounds + 1, usage: usageOf(ai) };
    } catch (e) {
      return { messages: brief, researchRounds: deps.maxResearchRounds, aiErrors: [`research: ${errorText(e)}`] };
    }
  };

  const runTools = async (s: AssessmentState): Promise<Update> => {
    current = s;
    const lastMessage = s.messages.at(-1) as AIMessage;
    const results: ToolMessage[] = [];
    for (const call of lastMessage.tool_calls ?? []) {
      const t = toolsByName.get(call.name);
      if (!t) {
        results.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content: `Unknown tool ${call.name}`, status: 'error' }));
        continue;
      }
      try {
        results.push((await t.invoke(call)) as ToolMessage);
      } catch (e) {
        results.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content: `Tool error: ${errorText(e)}`, status: 'error' }));
      }
    }
    return { messages: results, evidence: registry.list() };
  };

  const ensureEvidence = async (s: AssessmentState): Promise<Update> => {
    const concerns = concernDefs(s.bundle, s.concerns);
    const keys = new Set<string>([
      ...concerns.flatMap((c) => c.sourceKeys),
      ...concerns.flatMap((c) => c.explanations.flatMap((e) => e.sourceKeys)),
      ...concerns.flatMap((c) => c.careItems.map((id) => s.bundle.careItems[id]!.sourceKey)),
      ...(s.urgency?.triggered ?? []).map((t) => t.sourceKey),
      ...s.bundle.urgencyActions[s.urgency!.level].careItems.map((id) => s.bundle.careItems[id]!.sourceKey),
    ]);
    for (const chunk of await deps.knowledge.bySourceKeys([...keys], 2)) registry.add(chunk);
    return { evidence: registry.list() };
  };

  const decide = async (s: AssessmentState): Promise<Update> => {
    if (!deps.decisions) return {};
    await stage('ranking_explanations');
    const concerns = concernDefs(s.bundle, s.concerns);
    const candidates = concerns.flatMap((c) => c.explanations);
    const summary = caseSummary(s.bundle, s.facts, s.concerns, null, s.context.memory);
    const criteria = Object.fromEntries(
      candidates.map((e) => [
        e.code,
        `${e.clinical}. Supported by: ${e.supportingFacts.map((f) => s.bundle.facts[f]?.label).join(', ') || 'nonspecific features'}. Less likely with: ${e.againstFacts.map((f) => s.bundle.facts[f]?.label).join(', ') || 'none'}.`,
      ]),
    );
    try {
      const res = await deps.decisions.decide(
        { age: summary.age, concerns: summary.concerns.map((c) => c.label), present: summary.present, absent: summary.absent, unknown: summary.unknown },
        {
          ...(candidates.length > 1 ? { best_explanation: { type: 'choice' as const, instructions: 'Which approved candidate explanation best fits the findings?', criteria } } : {}),
          needs_emergency_care: { type: 'noul' as const, instructions: 'Do these findings suggest a medical emergency that needs immediate in-person care?' },
        },
      );
      const best = res.answers.best_explanation;
      const ranking = best?.type === 'choice' ? best.probabilities : candidates.length === 1 ? { [candidates[0]!.code]: 1 } : null;
      const emergency = res.answers.needs_emergency_care;
      const reviewReasons =
        emergency?.type === 'noul' && emergency.noul >= DECISION_REVIEW_THRESHOLD && s.urgency!.level !== 'emergency'
          ? ['decision_model_flagged_possible_emergency']
          : [];
      return { ranking, reviewReasons, usage: res.usage };
    } catch (e) {
      return { aiErrors: [`decisions: ${errorText(e)}`] };
    }
  };

  const draft = async (s: AssessmentState): Promise<Update> => {
    const concerns = concernDefs(s.bundle, s.concerns);
    const fallback = (generator: Generator, errors: string[] = []): Update => ({
      draft: templateDraft(s.bundle, s.facts, concerns, s.urgency!.level, registry, s.ranking ?? undefined, s.context.memory),
      generator,
      issues: [],
      aiErrors: errors,
    });
    if (!deps.models) return fallback('template');
    if (s.aiErrors.some((e) => e.startsWith('research:'))) return fallback('template_fallback');

    await stage('drafting', { attempt: s.draftAttempts + 1 });
    const candidates = concerns.flatMap((c) => c.explanations);
    const codes = candidates.map((c) => c.code) as [string, ...string[]];
    const payload = {
      writeTo: 'The person who sent this, as "you". Start the summary with "You".',
      case: caseSummary(s.bundle, s.facts, s.concerns, s.urgency, s.context.memory),
      requiredNextStep: s.bundle.urgencyActions[s.urgency!.level].title,
      candidates: candidates.map((c) => ({ code: c.code, label: c.label, description: c.plain })),
      calibratedRanking: s.ranking,
      evidence: registry.list().map((r) => ({ id: r.citationId, source: r.title, heading: r.heading, text: r.excerpt })),
      ...(s.issues.length ? { previousAttemptRejectedFor: s.issues } : {}),
    };
    try {
      const runnable = deps.models.chat.withStructuredOutput(draftSchema(codes), { name: 'submit_assessment_draft', includeRaw: true, method: 'functionCalling' });
      const { parsed, raw } = (await runnable.invoke([new SystemMessage(DRAFT_SYSTEM), new HumanMessage(JSON.stringify(payload))])) as { parsed: Draft; raw: unknown };
      return { draft: parsed, draftAttempts: s.draftAttempts + 1, generator: 'llm', usage: usageOf(raw) };
    } catch (e) {
      return { draft: null, draftAttempts: s.draftAttempts + 1, generator: 'llm', issues: [`Draft could not be produced: ${errorText(e)}`] };
    }
  };

  const verify = async (s: AssessmentState): Promise<Update> => {
    await stage('verifying');
    if (!s.draft) return {};
    const explanations = concernDefs(s.bundle, s.concerns).flatMap((c) => c.explanations);
    const groundText = [
      ...s.context.memory.map((m) => m.text),
      ...registry.list().map((r) => r.excerpt),
      ...explanations.flatMap((e) => [e.label, e.plain, e.clinical]),
    ].join('\n');
    const issues = verifyDraft(s.draft, {
      candidateCodes: new Set(explanations.map((e) => e.code)),
      citationIds: new Set(registry.list().map((r) => r.citationId)),
      urgency: s.urgency!.level,
      memoryIds: new Set(s.context.memory.map((m) => m.id)),
      groundText,
      watchTerms: deps.watchTerms,
    });
    let draftOut = s.draft;
    if (!issues.length && s.ranking) {
      const t = templateDraft(s.bundle, s.facts, concernDefs(s.bundle, s.concerns), s.urgency!.level, registry, s.ranking);
      const calibrated = new Map(t.explanations.map((e) => [e.code, e.likelihood]));
      draftOut = {
        ...s.draft,
        explanations: [...s.draft.explanations]
          .map((e) => ({ ...e, likelihood: calibrated.get(e.code) ?? e.likelihood }))
          .sort((a, b) => (s.ranking![b.code] ?? 0) - (s.ranking![a.code] ?? 0)),
      };
    }
    return { issues, draft: draftOut };
  };

  const fallback = async (s: AssessmentState): Promise<Update> => ({
    draft: templateDraft(s.bundle, s.facts, concernDefs(s.bundle, s.concerns), s.urgency!.level, registry, s.ranking ?? undefined, s.context.memory),
    generator: 'template_fallback',
    reviewReasons: ['ai_draft_failed_verification'],
  });

  const finalize = async (s: AssessmentState): Promise<Update> => {
    await stage('finalizing');
    const concerns = concernDefs(s.bundle, s.concerns);
    const missing = missingRequiredFacts(s.bundle, s.facts, concerns);
    const limitations: string[] = [];
    if (missing.length) limitations.push('Some important questions were not answered, so this result is less certain. Please speak with a clinician if you are unsure.');
    if (s.generator === 'template') {
      limitations.push(
        deps.aiPaused
          ? 'AI explanations are temporarily unavailable, so this result uses Nora’s standard approved guidance. Your urgency advice is unaffected.'
          : 'AI explanations are switched off; this result uses Nora’s standard approved guidance.',
      );
    }
    if (s.generator === 'template_fallback') {
      limitations.push(
        s.aiErrors.some((e) => e.startsWith('research:')) || (s.issues.length > 0 && s.issues.every((i) => i.startsWith('Draft could not be produced')))
          ? 'The AI service didn’t respond properly, so Nora is showing its standard approved guidance instead. Your urgency advice is unaffected.'
          : 'The AI explanation could not be verified, so Nora is showing its standard approved guidance instead.',
      );
    }
    if (s.reviewReasons.includes('decision_model_flagged_possible_emergency')) {
      limitations.push(`A secondary safety check suggested this may be more serious. If you feel very unwell, call ${s.context.emergency.number}.`);
    }
    const records = recordQuestions(s.context.memory);
    const draft: Draft = {
      ...s.draft!,
      questionsForClinician: [...new Set([...records.questions, ...s.draft!.questionsForClinician])].slice(0, 5),
      memoryRefs: [...new Set([...s.draft!.memoryRefs, ...records.refs])],
    };
    const result = buildResult({
      bundle: s.bundle,
      facts: s.facts,
      concerns,
      urgency: s.urgency!,
      registry,
      draft,
      status: missing.length ? 'INCOMPLETE' : 'COMPLETED',
      generator: s.generator,
      model: s.generator === 'llm' ? (deps.models?.chatName ?? null) : null,
      missing,
      limitations,
      emergency: s.context.emergency,
      verification: { passed: s.issues.length === 0, attempts: s.draftAttempts, issues: s.issues },
      memory: s.context.memory,
    });
    return { outcome: missing.length ? 'INCOMPLETE' : 'COMPLETED', result, evidence: registry.list() };
  };

  const graph = new StateGraph(State)
    .addNode('extract', extract)
    .addNode('triage', triage)
    .addNode('escalate', escalate)
    .addNode('unsupported', unsupported)
    .addNode('select_question', selectQuestion)
    .addNode('research', research)
    .addNode('tools', runTools)
    .addNode('ensure_evidence', ensureEvidence)
    .addNode('decide', decide)
    .addNode('compose_draft', draft)
    .addNode('verify', verify)
    .addNode('fallback', fallback)
    .addNode('finalize', finalize)
    .addEdge(START, 'extract')
    .addEdge('extract', 'triage')
    .addConditionalEdges(
      'triage',
      (s) => {
        if (s.urgency!.level === 'emergency') return 'escalate';
        if (!s.scope!.inScope && s.scope!.exclusionId !== 'x_unsupported_concern') return 'unsupported';
        return 'select_question';
      },
      ['escalate', 'unsupported', 'select_question'],
    )
    .addConditionalEdges(
      'select_question',
      (s) => {
        if (s.outcome === 'NEEDS_INPUT') return END;
        if (!s.scope!.inScope) return 'unsupported';
        return deps.models ? 'research' : 'ensure_evidence';
      },
      [END, 'unsupported', 'research', 'ensure_evidence'],
    )
    .addConditionalEdges(
      'research',
      (s) => {
        const lastMessage = s.messages.at(-1);
        return lastMessage instanceof AIMessage && lastMessage.tool_calls?.length ? 'tools' : 'ensure_evidence';
      },
      ['tools', 'ensure_evidence'],
    )
    .addConditionalEdges('tools', (s) => (s.researchRounds < deps.maxResearchRounds ? 'research' : 'ensure_evidence'), ['research', 'ensure_evidence'])
    .addEdge('ensure_evidence', 'decide')
    .addEdge('decide', 'compose_draft')
    .addEdge('compose_draft', 'verify')
    .addConditionalEdges(
      'verify',
      (s) => {
        if (s.draft && (s.issues.length === 0 || s.generator !== 'llm')) return 'finalize';
        return s.draftAttempts < MAX_DRAFT_ATTEMPTS ? 'compose_draft' : 'fallback';
      },
      ['finalize', 'compose_draft', 'fallback'],
    )
    .addEdge('fallback', 'finalize')
    .addEdge('escalate', END)
    .addEdge('unsupported', END)
    .addEdge('finalize', END);

  return graph.compile();
}

export async function runAssessment(deps: AssessmentDeps, input: AssessmentInput): Promise<AssessmentState> {
  return buildAssessmentGraph(deps).invoke(input, { recursionLimit: 50 });
}
