import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AiProvider, AiService, isProviderFailure, type ProviderName } from '../ai/ai.service.js';
import { runAssessment } from '../assessment/graph/assessment-graph.js';
import { PROMPT_VERSION } from '../assessment/graph/prompts.js';
import type { FactMap } from '../clinical/rules-engine.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { DbKnowledge } from '../knowledge/db-knowledge.js';
import { MemoryService } from '../memory/memory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CaseStore, type FactProvenance } from './case-store.js';
import { ASSESS_JOB } from './checks.service.js';

interface ClaimedJob {
  id: string;
  type: string;
  resource_id: string;
  payload: { inputVersion?: number; messageId?: string };
  attempts: number;
}

const POLL_MS = 400;
const MAX_ATTEMPTS = 3;
/** Stage details that are safe to show the patient; model-written search queries are not. */
const DISPLAY_DETAIL_KEYS = ['round', 'attempt'];

const SESSION_STATUS = { COMPLETED: 'COMPLETED', INCOMPLETE: 'INCOMPLETE', ESCALATED: 'ESCALATED', UNSUPPORTED: 'COMPLETED' } as const;

/**
 * Runs assessment jobs from the outbox. Jobs can run more than once, so every
 * write is guarded by the session's input version: a result computed for
 * superseded input is discarded.
 */
@Injectable()
export class AssessmentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssessmentWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CaseStore,
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    if (!this.config.get('WORKER_ENABLED', { infer: true })) return;
    this.timer = setInterval(() => void this.drain(), POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = await this.claim(); job; job = await this.claim()) await this.run(job);
    } catch (error) {
      this.logger.error(`Outbox polling failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE outbox_jobs SET status = 'RUNNING', locked_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM outbox_jobs
        WHERE type = ${ASSESS_JOB}
          AND ((status = 'PENDING' AND run_after <= now()) OR (status = 'RUNNING' AND locked_at < now() - interval '5 minutes'))
        ORDER BY run_after
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, resource_id, payload, attempts`;
    return rows[0] ?? null;
  }

  private async run(job: ClaimedJob) {
    try {
      await this.assess(job, job.attempts >= MAX_ATTEMPTS);
      await this.prisma.outboxJob.update({ where: { id: job.id }, data: { status: 'DONE', completedAt: new Date(), lockedAt: null } });
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      this.logger.warn(`Assessment job ${job.id} attempt ${job.attempts} failed: ${message}`);
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      await this.prisma.outboxJob.update({
        where: { id: job.id },
        data: exhausted
          ? { status: 'FAILED', lastError: message, lockedAt: null }
          : { status: 'PENDING', lastError: message, lockedAt: null, runAfter: new Date(Date.now() + 1000 * 2 ** job.attempts) },
      });
      if (exhausted) await this.markFailed(job);
    }
  }

  private async assess(job: ClaimedJob, templateOnly: boolean) {
    const inputVersion = job.payload.inputVersion ?? -1;
    const session = await this.prisma.assessmentSession.findUnique({ where: { id: job.resource_id } });
    if (!session || session.inputVersion !== inputVersion) return;

    const [bundle, tenantCtx, facts, asked, message, memory, watchTerms] = await Promise.all([
      this.store.bundle(session.bundleId),
      this.store.tenantContext(session.tenantId),
      this.store.facts(this.prisma, session.id),
      this.store.askedQuestions(this.prisma, session.id),
      job.payload.messageId ? this.prisma.message.findUnique({ where: { id: job.payload.messageId } }) : null,
      this.memory.forPatient(session.tenantId, session.patientUserId, { excludeSessionId: session.id }),
      this.watchTerms(session.tenantId),
    ]);
    const aiPaused = tenantCtx.aiEnabled && this.ai.configured() && !this.ai.available();
    let provider = tenantCtx.aiEnabled && !templateOnly ? this.ai.next() : null;
    const tried: ProviderName[] = [];
    const started = Date.now();
    await this.store.event(this.prisma, session.id, 'stage', { stage: 'started' });

    const run = (p: AiProvider | null) =>
      runAssessment(
        {
          models: p?.models ?? null,
          decisions: p?.decisions ?? null,
          knowledge: new DbKnowledge(this.prisma, session.tenantId),
          maxResearchRounds: this.ai.maxResearchRounds,
          aiPaused,
          watchTerms,
          onStage: (stage, detail) =>
            this.store.event(this.prisma, session.id, 'stage', {
              stage,
              ...Object.fromEntries(Object.entries(detail ?? {}).filter(([k]) => DISPLAY_DETAIL_KEYS.includes(k))),
            }),
        },
        {
          bundle,
          context: {
            patientMessage: message ? { id: message.id, text: message.text } : null,
            memory,
            emergency: tenantCtx.emergency,
            parentCheckId: session.parentSessionId,
          },
          facts,
          asked,
          turnCount: session.turnCount,
        },
      );

    let out = await run(provider);
    while (provider) {
      if (out.aiErrors.length) this.logger.warn(`Assessment ${session.id} AI issues (${provider.label}): ${out.aiErrors.join(' | ')}`);
      const calledModel = out.usage.inputTokens > 0 || out.aiErrors.length > 0;
      if (calledModel) this.ai.record(provider, out.aiErrors);
      tried.push(provider.name);
      const fallback = out.aiErrors.some(isProviderFailure) ? this.ai.next(Date.now(), tried) : null;
      if (!fallback) break;
      this.logger.warn(`Assessment ${session.id}: ${provider.label} failed, retrying with ${fallback.label}`);
      provider = fallback;
      out = await run(provider);
    }
    const outcome = out.outcome;
    if (!outcome) throw new Error('Assessment finished without an outcome');

    const changes: FactMap = {};
    for (const [key, value] of Object.entries(out.facts)) {
      const before = facts[key];
      if (!before || before.state !== value.state || (before.value ?? null) !== (value.value ?? null)) changes[key] = value;
    }
    const provenance: Record<string, FactProvenance> = {};
    for (const o of out.observations) provenance[o.factKey] = { quote: o.quote, assertion: o.assertion, sourceMessageId: message?.id };

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.assessmentSession.updateMany({ where: { id: session.id, inputVersion }, data: { version: { increment: 1 } } });
      if (current.count !== 1) return;

      await this.store.writeFacts(tx, session.id, changes, inputVersion, provenance);
      const urgency = out.urgency!;
      await tx.urgencyDecision.create({
        data: { sessionId: session.id, inputVersion, level: urgency.level, ruleIds: urgency.triggered.map((t) => t.ruleId), bundleId: session.bundleId },
      });
      const concernCode = out.concerns[0] ?? null;

      if (outcome === 'NEEDS_INPUT') {
        const question = bundle.questions[out.nextQuestionId!]!;
        await tx.message.create({
          data: { sessionId: session.id, sender: 'nora', kind: 'question', text: question.text, questionId: out.nextQuestionId, inputVersion },
        });
        await tx.assessmentSession.update({
          where: { id: session.id },
          data: { status: 'COLLECTING', pendingQuestionId: out.nextQuestionId, urgency: urgency.level, concernCode },
        });
        await this.store.event(tx, session.id, 'question', { questionId: out.nextQuestionId });
        return;
      }

      const content = out.result!;
      const result = await tx.assessmentResult.create({
        data: {
          sessionId: session.id,
          tenantId: session.tenantId,
          inputVersion,
          inputHash: hashFacts(out.facts),
          bundleId: session.bundleId,
          schemaVersion: content.schemaVersion,
          status: content.status,
          urgency: content.urgency.level,
          generator: content.generator,
          model: content.model,
          promptVersion: content.generator === 'llm' ? PROMPT_VERSION : null,
          content: content as unknown as Prisma.InputJsonValue,
          latencyMs: Date.now() - started,
          usage: out.usage as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.assessmentResult.updateMany({ where: { sessionId: session.id, id: { not: result.id }, supersededAt: null }, data: { supersededAt: new Date() } });
      if (out.evidence.length) {
        await tx.evidenceLink.createMany({
          data: out.evidence.map((e) => ({ resultId: result.id, chunkId: e.chunkId, documentId: e.documentId, citationId: e.citationId })),
          skipDuplicates: true,
        });
      }
      await tx.message.create({ data: { sessionId: session.id, sender: 'nora', kind: 'result', text: content.summary, inputVersion } });
      await tx.assessmentSession.update({
        where: { id: session.id },
        data: { status: SESSION_STATUS[outcome], pendingQuestionId: null, currentResultId: result.id, urgency: urgency.level, concernCode },
      });

      const reasons = [...out.reviewReasons];
      if (urgency.level === 'urgent' || urgency.level === 'emergency') reasons.push(`urgency_${urgency.level}`);
      if (reasons.length) {
        await tx.reviewTask.create({
          data: {
            tenantId: session.tenantId,
            sessionId: session.id,
            resultId: result.id,
            reason: reasons.join(','),
            dueAt: new Date(Date.now() + tenantCtx.reviewSlaHours * 3_600_000),
          },
        });
      }
      await this.store.event(tx, session.id, 'result', { status: content.status, urgency: urgency.level });
    });
  }

  private async markFailed(job: ClaimedJob) {
    const inputVersion = job.payload.inputVersion ?? -1;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assessmentSession.updateMany({
        where: { id: job.resource_id, inputVersion, status: 'ASSESSING' },
        data: { status: 'COLLECTING' },
      });
      if (updated.count !== 1) return;
      await tx.message.create({
        data: {
          sessionId: job.resource_id,
          sender: 'nora',
          kind: 'error',
          text: 'Sorry, Nora could not process that just now. Please try sending it again. If you feel very unwell, do not wait — contact emergency services.',
          inputVersion,
        },
      });
      await this.store.event(tx, job.resource_id, 'error');
    });
  }

  /** Medicine names from the approved library plus common long-term conditions; drafts may only name them when grounded. */
  private async watchTerms(tenantId: string): Promise<string[]> {
    const medicines = await this.prisma.medicineEntry.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      select: { genericName: true, brandExamples: true },
    });
    return [...new Set([...medicines.flatMap((m) => [m.genericName, ...m.brandExamples]), ...CONDITION_TERMS].map((t) => t.toLowerCase()))];
  }
}

const CONDITION_TERMS = ['diabetes', 'hypertension', 'high blood pressure', 'asthma', 'COPD', 'thyroid', 'hypothyroidism', 'kidney disease', 'heart disease', 'epilepsy', 'cancer', 'HIV', 'tuberculosis'];

function hashFacts(facts: FactMap): string {
  const sorted = Object.keys(facts)
    .sort()
    .map((k) => [k, facts[k]!.state, facts[k]!.value ?? null]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
