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
  episodeFacts,
  evaluateUrgency,
  type FactMap,
  nextQuestion,
  type ScopeOutcome,
  unresolvedSafety,
  type UrgencyOutcome,
} from '../../clinical/rules-engine.js';
import type { KnowledgePort } from '../../knowledge/knowledge.port.js';
import { applyHedged, applyObservations, extractWithModel, guardConfirmed, mergeObservations, type TokenUsage, usageOf } from '../extraction/llm-extractor.js';
import { extractWithRules, hedgedMentions, type Observation } from '../extraction/rule-extractor.js';
import type { AnswerConflict, EvidenceRef, Generator, ResultContent } from '../result.types.js';
import { answerFacts, recommendationConflicts } from './consistency.js';
import { triage } from '../../clinical/triage.js';
import {
  buildResult,
  caseSummary,
  citedSourceKeys,
  concernDefs,
  daysSince,
  type EmergencyContacts,
  episodeContext,
  escalationResult,
  information,
  recordQuestions,
  recurrence,
  relevantMemory,
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
/** Enough to load every passage of a source, so each claim can cite the passage that supports it. */
const PASSAGES_PER_SOURCE = 20;

export type Outcome = 'NEEDS_INPUT' | 'COMPLETED' | 'INCOMPLETE' | 'ESCALATED' | 'UNSUPPORTED';

export interface CaseContext {
  patientMessage: { id: string; text: string } | null;
  /** Confirmed records only; see MemoryService. */
  memory: MemoryItem[];
  emergency: EmergencyContacts;
  /** The check this one deliberately follows up; it does not count as a recurrence. */
  parentCheckId?: string | null;
  /** Answer conflicts found on earlier turns of this check. */
  conflicts?: AnswerConflict[];
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
  /** Conflicts found in this run's message. */
  conflicts: Annotation<AnswerConflict[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** Facts this run's message mentioned with doubt; Nora will ask about them. */
  hedged: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  asked: last<string[]>(),
  turnCount: last<number>(),
  concerns: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  urgency: Annotation<UrgencyOutcome | null>({ reducer: (_a, b) => b, default: () => null }),
  scope: Annotation<ScopeOutcome | null>({ reducer: (_a, b) => b, default: () => null }),
  nextQuestionId: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  researchRounds: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  evidence: Annotation<EvidenceRef[]>({ reducer: (_a, b) => b, default: () => [] }),
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

const conflictsOf = (s: AssessmentState) => [...(s.context.conflicts ?? []), ...s.conflicts];

/** The records this consultation may use; unrelated earlier checks never reach the AI or the result. */
const recordsOf = (s: AssessmentState) => relevantMemory(s.context.memory, s.context.parentCheckId, priorCheck(s, s.concerns));

/** Real verification failures, as opposed to the model not producing a draft at all. */
const verificationFailed = (s: AssessmentState) => s.issues.some((i) => !i.startsWith('Draft could not be produced'));

/** Source of a duration Nora lengthened because the patient said the problem never went away after their earlier check. */
export const EPISODE_SOURCE = 'episode';

/**
 * A recent finished check for the same problem. A follow-up already names
 * its earlier check, so Nora doesn't ask about a second one.
 */
const priorCheck = (s: AssessmentState, concerns: string[]) =>
  s.context.parentCheckId ? null : recurrence(s.bundle, concerns, s.context.memory, s.context.now ?? new Date());

const draftSchema = z.object({
  summary: z
    .string()
    .min(20)
    .max(1200)
    .describe('2–3 plain-language sentences restating what you reported (symptoms, timings, exposures) and what the required next step means; no causes or conditions'),
  questionsForClinician: z.array(z.string().max(200)).max(4),
  memoryRefs: z.array(z.string()).max(8).describe('IDs of memory items (like "M2") the text relies on; empty if none'),
});

/**
 * Builds the per-run assessment graph. Deterministic nodes own urgency, scope,
 * question selection and the general information shown; model-backed nodes
 * only read the patient's words, research and write a summary, and every
 * draft is verified.
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
    caseSummary: () => caseSummary(current.bundle, current.facts, current.concerns, current.urgency, recordsOf(current)),
    onSearch: (query) => stage('searching_knowledge', { query }),
  });
  const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t as StructuredToolInterface]));

  const extract = async (s: AssessmentState): Promise<Update> => {
    if (!s.context.patientMessage) return {};
    await stage('extracting');
    const text = s.context.patientMessage.text;
    const ruleHedged = hedgedMentions(s.bundle, text);
    const answerOnly = episodeFacts(s.bundle);
    const apply = (extracted: Observation[], mentioned: { factKey: string; quote: string }[]): Update => {
      const all = extracted.filter((o) => !answerOnly.has(o.factKey));
      const hedged = mentioned.filter((h) => !answerOnly.has(h.factKey));
      const doubted = new Set(hedged.map((h) => h.factKey));
      const observations = all.filter((o) => !doubted.has(o.factKey) || (s.bundle.facts[o.factKey]?.critical && o.state === 'PRESENT'));
      const guarded = guardConfirmed(s.bundle, s.facts, observations);
      const unclear = applyHedged(s.facts, hedged, guarded.observations);
      return {
        observations: guarded.observations,
        facts: { ...unclear, ...guarded.reopen, ...applyObservations(s.bundle, s.facts, guarded.observations) },
        conflicts: guarded.conflicts,
        hedged: Object.keys(unclear),
      };
    };
    const rules = extractWithRules(s.bundle, text);
    const ruleUpdate = apply(rules, ruleHedged);
    const ruleFacts = { ...s.facts, ...ruleUpdate.facts };
    const quick = evaluateUrgency(s.bundle, ruleFacts, detectConcerns(s.bundle, ruleFacts));
    if (quick.level === 'emergency' || !deps.models) return ruleUpdate;
    try {
      const llm = await extractWithModel(deps.models.fast, s.bundle, text);
      return { ...apply(mergeObservations(s.bundle, rules, llm.observations), [...ruleHedged, ...llm.hedged]), usage: llm.usage };
    } catch (e) {
      return { ...ruleUpdate, aiErrors: [`extraction: ${errorText(e)}`] };
    }
  };

  /**
   * The earlier check only makes Nora ask how this one relates to it; the
   * patient's answer, not the record, decides whether it counts. When they say
   * it never went away, the time since that check is the shortest it can have
   * lasted.
   */
  const triageNode = async (s: AssessmentState): Promise<Update> => {
    await stage('checking_safety');
    const concerns = detectConcerns(s.bundle, s.facts);
    const codes = concerns.map((c) => c.code);
    const facts: FactMap = { ...s.facts };
    const prior = priorCheck(s, codes);
    if (prior && s.bundle.facts.prior_similar_check && !facts.prior_similar_check) {
      facts.prior_similar_check = { state: 'PRESENT', source: 'memory' };
    }
    const since = prior ? daysSince(prior.recordedAt ?? undefined, s.context.now ?? new Date()) : null;
    const reported = facts.duration_days?.state === 'PRESENT' ? Number(facts.duration_days.value) : null;
    if (facts.episode_ongoing?.state === 'PRESENT' && since !== null && reported !== null && reported < since && s.bundle.facts.duration_days) {
      facts.duration_days = { state: 'PRESENT', value: since, source: EPISODE_SOURCE };
    }
    return {
      concerns: codes,
      facts,
      urgency: triage(s.bundle, facts, concerns).urgency,
      scope: checkScope(s.bundle, facts, concerns),
    };
  };

  const escalate = async (s: AssessmentState): Promise<Update> => {
    await stage('escalating');
    const urgency = s.urgency!;
    const concerns = concernDefs(s.bundle, s.concerns);
    const keys = [
      ...urgency.triggered.map((t) => t.sourceKey),
      ...s.bundle.urgencyActions.emergency.careItems.map((id) => s.bundle.careItems[id]!.sourceKey),
    ];
    for (const chunk of await deps.knowledge.bySourceKeys([...new Set(keys)], PASSAGES_PER_SOURCE)) registry.add(chunk);
    const result = escalationResult(s.bundle, s.facts, concerns, urgency, registry, s.context.emergency, recordsOf(s), conflictsOf(s), {
      episode: episodeContext(s.facts, priorCheck(s, s.concerns)),
    });
    return { outcome: 'ESCALATED', result, evidence: result.evidence, generator: 'rules' };
  };

  const unsupported = async (s: AssessmentState): Promise<Update> => {
    const keys = ['src_self_care_general', ...(s.urgency?.triggered ?? []).map((t) => t.sourceKey)];
    for (const chunk of await deps.knowledge.bySourceKeys([...new Set(keys)], PASSAGES_PER_SOURCE)) registry.add(chunk);
    const message = s.scope?.message ?? 'Nora cannot assess this concern yet. Please speak with a doctor.';
    const result = unsupportedResult(s.bundle, s.facts, s.urgency!, message, registry, s.context.emergency, recordsOf(s), conflictsOf(s));
    return { outcome: 'UNSUPPORTED', result, evidence: result.evidence, generator: 'rules' };
  };

  /** Nora keeps asking while anything important is open; the plan is finite because answered questions are never asked again. */
  const selectQuestion = async (s: AssessmentState): Promise<Update> => {
    const q = nextQuestion(s.bundle, s.facts, concernDefs(s.bundle, s.concerns), new Set(s.asked));
    if (q) return { nextQuestionId: q.id, outcome: 'NEEDS_INPUT' };
    return { nextQuestionId: null };
  };

  const research = async (s: AssessmentState): Promise<Update> => {
    current = s;
    await stage('researching', { round: s.researchRounds + 1 });
    const brief = s.messages.length
      ? []
      : [new HumanMessage(`Gather approved evidence for this case.\n${JSON.stringify(caseSummary(s.bundle, s.facts, s.concerns, s.urgency, recordsOf(s)))}`)];
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
    const keys = citedSourceKeys(s.bundle, concernDefs(s.bundle, s.concerns), s.urgency!, s.facts);
    for (const chunk of await deps.knowledge.bySourceKeys(keys, PASSAGES_PER_SOURCE)) registry.add(chunk);
    return { evidence: registry.list() };
  };

  /**
   * A second opinion that can only ask for a clinician to look: a model that
   * thinks the case may be an emergency flags it for review. It never changes
   * the urgency the rules set, and Nora doesn't ask it for a likely cause.
   */
  const decide = async (s: AssessmentState): Promise<Update> => {
    if (!deps.decisions) return {};
    await stage('cross_checking');
    const summary = caseSummary(s.bundle, s.facts, s.concerns, null, recordsOf(s));
    try {
      const res = await deps.decisions.decide(
        {
          age: summary.age,
          concerns: summary.concerns.map((c) => c.label),
          ...summary.thisConsultation,
          exposures: summary.exposures,
          healthBackground: summary.healthBackground.present,
        },
        {
          needs_emergency_care: { type: 'noul' as const, instructions: 'Do these findings suggest a medical emergency that needs immediate in-person care?' },
        },
      );
      const emergency = res.answers.needs_emergency_care;
      const reviewReasons =
        emergency?.type === 'noul' && emergency.noul >= DECISION_REVIEW_THRESHOLD && s.urgency!.level !== 'emergency'
          ? ['decision_model_flagged_possible_emergency']
          : [];
      return { reviewReasons, usage: res.usage };
    } catch (e) {
      return { aiErrors: [`decisions: ${errorText(e)}`] };
    }
  };

  const draft = async (s: AssessmentState): Promise<Update> => {
    const concerns = concernDefs(s.bundle, s.concerns);
    const fallback = (generator: Generator, errors: string[] = []): Update => ({
      draft: templateDraft(s.bundle, s.facts, recordsOf(s)),
      generator,
      issues: [],
      aiErrors: errors,
    });
    if (!deps.models) return fallback('template');
    if (s.aiErrors.some((e) => e.startsWith('research:'))) return fallback('template_fallback');

    await stage('drafting', { attempt: s.draftAttempts + 1 });
    const payload = {
      writeTo: 'The person who sent this, as "you". Start the summary with "You".',
      case: caseSummary(s.bundle, s.facts, s.concerns, s.urgency, recordsOf(s)),
      requiredNextStep: s.bundle.urgencyActions[s.urgency!.level].title,
      shownSeparately: information(concerns, s.facts).map((i) => i.title),
      evidence: registry.list().map((r) => ({ id: r.citationId, source: r.title, heading: r.heading, text: r.excerpt })),
      ...(s.issues.length ? { previousAttemptRejectedFor: s.issues } : {}),
    };
    try {
      const runnable = deps.models.chat.withStructuredOutput(draftSchema, { name: 'submit_assessment_draft', includeRaw: true, method: 'functionCalling' });
      const { parsed, raw } = (await runnable.invoke([new SystemMessage(DRAFT_SYSTEM), new HumanMessage(JSON.stringify(payload))])) as { parsed: Draft; raw: unknown };
      return { draft: parsed, draftAttempts: s.draftAttempts + 1, generator: 'llm', usage: usageOf(raw) };
    } catch (e) {
      return {
        draft: null,
        draftAttempts: s.draftAttempts + 1,
        generator: 'llm',
        issues: [`Draft could not be produced: ${errorText(e)}`],
        aiErrors: [`draft: ${errorText(e)}`],
      };
    }
  };

  const verify = async (s: AssessmentState): Promise<Update> => {
    await stage('verifying');
    if (!s.draft) return {};
    const records = recordsOf(s);
    const groundText = [
      ...records.map((m) => m.text),
      ...registry.list().map((r) => r.excerpt),
      ...information(concernDefs(s.bundle, s.concerns), s.facts).map((i) => i.text),
    ].join('\n');
    const issues = verifyDraft(s.draft, {
      citationIds: new Set(registry.list().map((r) => r.citationId)),
      urgency: s.urgency!.level,
      memoryIds: new Set(records.map((m) => m.id)),
      groundText,
      watchTerms: deps.watchTerms,
      answers: answerFacts(s.bundle, s.facts),
    });
    return { issues };
  };

  const fallback = async (s: AssessmentState): Promise<Update> => ({
    draft: templateDraft(s.bundle, s.facts, recordsOf(s)),
    generator: 'template_fallback',
    reviewReasons: verificationFailed(s) ? ['ai_draft_failed_verification'] : [],
  });

  const finalize = async (s: AssessmentState): Promise<Update> => {
    await stage('finalizing');
    const concerns = concernDefs(s.bundle, s.concerns);
    const decision = triage(s.bundle, s.facts, concerns);
    const unresolved = unresolvedSafety(s.bundle, s.facts, concerns);
    const missing = [...new Set([...decision.missingRequired.map((m) => m.key), ...unresolved])];
    const unverified = s.generator === 'template_fallback' && verificationFailed(s);
    const urgency = s.urgency!;
    const limitations: string[] = [];
    if (unresolved.length) {
      limitations.push('You weren’t sure about, or skipped, a question about warning signs. Nora can’t assume they are absent, so it recommends a doctor checks you.');
    } else if (missing.length) {
      limitations.push('Some important questions were not answered, so this result is less certain. Please speak with a clinician if you are unsure.');
    }
    if (s.generator === 'template') {
      limitations.push(
        deps.aiPaused
          ? 'The AI-written summary is temporarily unavailable, so this result uses Nora’s standard approved wording. Your urgency advice comes from Nora’s safety rules and is unaffected.'
          : 'AI-written summaries are switched off; this result uses Nora’s standard approved wording.',
      );
    }
    if (s.generator === 'template_fallback') {
      limitations.push(
        unverified
          ? 'The AI-written summary didn’t pass Nora’s checks, so it isn’t shown. The summary below is Nora’s standard wording, and a clinician will review this result. Your urgency advice comes from Nora’s clinical rules and is unaffected.'
          : 'The AI service didn’t respond properly, so Nora is showing its standard approved wording instead. Your urgency advice comes from Nora’s clinical rules and is unaffected.',
      );
    }
    const memory = recordsOf(s);
    const records = recordQuestions(memory);
    const recordNames = memory.filter((m) => records.refs.includes(m.id)).map((m) => m.text.toLowerCase());
    const draft: Draft = {
      ...s.draft!,
      questionsForClinician: [
        ...new Set([...records.questions, ...s.draft!.questionsForClinician.filter((q) => !recordNames.some((n) => q.toLowerCase().includes(n)))]),
      ].slice(0, 5),
      memoryRefs: [...new Set([...s.draft!.memoryRefs, ...records.refs])],
    };
    const result = buildResult({
      bundle: s.bundle,
      facts: s.facts,
      concerns,
      urgency,
      answerConflicts: conflictsOf(s),
      registry,
      draft,
      status: missing.length ? 'INCOMPLETE' : 'COMPLETED',
      generator: s.generator,
      model: s.generator === 'llm' ? (deps.models?.chatName ?? null) : null,
      missing,
      limitations,
      emergency: s.context.emergency,
      verification: { passed: s.issues.length === 0, attempts: s.draftAttempts, issues: s.issues },
      memory,
      missingSafety: decision.missingSafety,
      episode: episodeContext(s.facts, priorCheck(s, s.concerns)),
    });
    const contradictions = recommendationConflicts(result);
    if (contradictions.length) result.verification = { ...result.verification, issues: [...result.verification.issues, ...contradictions] };
    return {
      outcome: missing.length ? 'INCOMPLETE' : 'COMPLETED',
      result,
      evidence: result.evidence,
      urgency,
      ...(contradictions.length ? { reviewReasons: ['contradiction_detected'] } : {}),
    };
  };

  const graph = new StateGraph(State)
    .addNode('extract', extract)
    .addNode('triage', triageNode)
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
