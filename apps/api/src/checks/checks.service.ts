import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { QuestionDef } from '../clinical/bundle.schema.js';
import type { FactMap } from '../clinical/rules-engine.js';
import { AppException } from '../common/app.exception.js';
import { ConsentService } from '../consent/consent.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ResultContent } from '../assessment/result.types.js';
import { type AnswerValue, InvalidAnswerError, mapAnswer } from './answer-mapping.js';
import { CaseStore, type Db } from './case-store.js';

export const ASSESS_JOB = 'assess';

export interface QuestionView {
  id: string;
  text: string;
  why: string | null;
  type: QuestionDef['type'];
  unit: string | null;
  min: number | null;
  max: number | null;
  allowSkip: boolean;
  options: { value: string; label: string; exclusive: boolean }[];
}

export interface CheckView {
  id: string;
  status: string;
  title: string | null;
  urgency: string | null;
  inputVersion: number;
  turnCount: number;
  createdAt: string;
  messages: { id: string; sender: string; kind: string; text: string; questionId: string | null; createdAt: string }[];
  pendingQuestion: QuestionView | null;
  result: (ResultContent & { createdAt: string }) | null;
  lastEventSequence: string;
  emergency: { number: string; crisisLine: { name: string; number: string } | null };
}

const ACTIVE = ['DRAFT', 'COLLECTING'] as const;

@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CaseStore,
    private readonly consent: ConsentService,
  ) {}

  async create(principal: AuthPrincipal, idempotencyKey: string): Promise<CheckView> {
    const existing = await this.prisma.assessmentSession.findUnique({
      where: { tenantId_patientUserId_idempotencyKey: { tenantId: principal.tenantId, patientUserId: principal.userId, idempotencyKey } },
    });
    if (existing) return this.view(principal, existing.id);

    const tenantCtx = await this.store.tenantContext(principal.tenantId);
    if (!tenantCtx.assessmentEnabled) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'ASSESSMENT_UNAVAILABLE', 'Symptom checks are not available right now. If you feel unwell, contact a doctor.');
    }
    if (!(await this.consent.hasGranted(principal.tenantId, principal.userId, 'PROCESSING'))) {
      throw new AppException(HttpStatus.CONFLICT, 'CONSENT_REQUIRED', 'Please review and accept how Nora uses your health information before starting a check.');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: principal.tenantId } });
    if (!tenant.activeBundleId) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'NO_ACTIVE_BUNDLE', 'Symptom checks are not set up for your organisation yet.');
    }

    const prefill = await this.profileFacts(principal);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assessmentSession.create({
        data: {
          tenantId: principal.tenantId,
          patientUserId: principal.userId,
          bundleId: tenant.activeBundleId!,
          status: 'COLLECTING',
          idempotencyKey,
        },
      });
      await this.store.writeFacts(tx, created.id, prefill, 0);
      await this.store.event(tx, created.id, 'created');
      return created;
    });
    return this.view(principal, session.id);
  }

  async list(principal: AuthPrincipal) {
    const rows = await this.prisma.assessmentSession.findMany({
      where: { tenantId: principal.tenantId, patientUserId: principal.userId, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, status: true, urgency: true, createdAt: true, updatedAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
  }

  async postMessage(principal: AuthPrincipal, id: string, text: string, idempotencyKey: string): Promise<CheckView> {
    const session = await this.owned(principal, id);
    const duplicate = await this.prisma.message.findUnique({ where: { sessionId_idempotencyKey: { sessionId: id, idempotencyKey } } });
    if (duplicate) return this.view(principal, id);
    this.assertCollecting(session.status);

    await this.prisma.$transaction(async (tx) => {
      const inputVersion = await this.bumpInput(tx, session.id, session.inputVersion, {
        title: session.title ?? shortTitle(text),
        pendingQuestionId: null,
      });
      const message = await tx.message.create({
        data: { sessionId: id, sender: 'patient', kind: 'text', text, inputVersion, idempotencyKey },
      });
      await this.enqueue(tx, principal, id, inputVersion, { messageId: message.id });
    });
    return this.view(principal, id);
  }

  async answer(principal: AuthPrincipal, id: string, questionId: string, inputVersion: number, value: AnswerValue): Promise<CheckView> {
    const session = await this.owned(principal, id);
    this.assertCollecting(session.status);
    if (session.inputVersion !== inputVersion || session.pendingQuestionId !== questionId) {
      throw new AppException(HttpStatus.CONFLICT, 'STALE_INPUT', 'This question has changed. Please review the latest question.', true);
    }
    const bundle = await this.store.bundle(session.bundleId);
    const question = bundle.questions[questionId];
    if (!question) throw new AppException(HttpStatus.BAD_REQUEST, 'UNKNOWN_QUESTION', 'This question is not part of the check.');

    let mapped;
    try {
      mapped = mapAnswer(question, value);
    } catch (error) {
      if (error instanceof InvalidAnswerError) throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_ANSWER', error.message);
      throw error;
    }

    await this.prisma.$transaction(async (tx) => {
      const next = await this.bumpInput(tx, session.id, session.inputVersion, { pendingQuestionId: null });
      await tx.answer.updateMany({ where: { sessionId: id, questionId, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.answer.create({
        data: { sessionId: id, questionId, state: this.answerState(mapped.facts), value: (value ?? Prisma.DbNull) as Prisma.InputJsonValue, inputVersion: next },
      });
      await this.store.writeFacts(tx, id, mapped.facts, next);
      await tx.message.create({ data: { sessionId: id, sender: 'patient', kind: 'answer', text: mapped.label, questionId, inputVersion: next } });
      await this.enqueue(tx, principal, id, next, {});
    });
    return this.view(principal, id);
  }

  async events(principal: AuthPrincipal, id: string, after: bigint) {
    const session = await this.owned(principal, id);
    const events = await this.prisma.sessionEvent.findMany({
      where: { sessionId: id, sequence: { gt: after } },
      orderBy: { sequence: 'asc' },
      take: 100,
    });
    return {
      status: session.status,
      inputVersion: session.inputVersion,
      events: events.map((e) => ({ sequence: e.sequence.toString(), type: e.type, payload: e.payload, createdAt: e.createdAt.toISOString() })),
    };
  }

  async view(principal: AuthPrincipal, id: string): Promise<CheckView> {
    const session = await this.owned(principal, id);
    const [messages, result, lastEvent, tenantCtx, bundle] = await Promise.all([
      this.prisma.message.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } }),
      session.currentResultId ? this.prisma.assessmentResult.findUnique({ where: { id: session.currentResultId } }) : null,
      this.prisma.sessionEvent.findFirst({ where: { sessionId: id }, orderBy: { sequence: 'desc' }, select: { sequence: true } }),
      this.store.tenantContext(principal.tenantId),
      this.store.bundle(session.bundleId),
    ]);
    const q = session.pendingQuestionId ? bundle.questions[session.pendingQuestionId] : undefined;
    return {
      id: session.id,
      status: session.status,
      title: session.title,
      urgency: session.urgency,
      inputVersion: session.inputVersion,
      turnCount: session.turnCount,
      createdAt: session.createdAt.toISOString(),
      messages: messages.map((m) => ({ id: m.id, sender: m.sender, kind: m.kind, text: m.text, questionId: m.questionId, createdAt: m.createdAt.toISOString() })),
      pendingQuestion: q
        ? {
            id: session.pendingQuestionId!,
            text: q.text,
            why: q.why ?? null,
            type: q.type,
            unit: q.unit ?? null,
            min: q.min ?? null,
            max: q.max ?? null,
            allowSkip: q.allowSkip,
            options: (q.options ?? []).map((o) => ({ value: o.value, label: o.label, exclusive: o.exclusive })),
          }
        : null,
      result: result
        ? { ...(result.content as unknown as ResultContent), createdAt: result.createdAt.toISOString() }
        : null,
      lastEventSequence: (lastEvent?.sequence ?? 0n).toString(),
      emergency: tenantCtx.emergency,
    };
  }

  private async owned(principal: AuthPrincipal, id: string) {
    const session = await this.prisma.assessmentSession.findFirst({
      where: { id, tenantId: principal.tenantId, patientUserId: principal.userId },
    });
    if (!session) throw new AppException(HttpStatus.NOT_FOUND, 'CHECK_NOT_FOUND', 'This check could not be found.');
    return session;
  }

  private assertCollecting(status: string) {
    if (status === 'ASSESSING') {
      throw new AppException(HttpStatus.CONFLICT, 'ASSESSMENT_IN_PROGRESS', 'Nora is still reviewing your last answer. Please wait a moment.', true);
    }
    if (!(ACTIVE as readonly string[]).includes(status)) {
      throw new AppException(HttpStatus.CONFLICT, 'CHECK_CLOSED', 'This check is finished. Start a new check to add information.');
    }
  }

  /** Optimistic update: fails if another request changed the check first. */
  private async bumpInput(tx: Db, id: string, expected: number, data: Prisma.AssessmentSessionUpdateManyMutationInput): Promise<number> {
    const updated = await tx.assessmentSession.updateMany({
      where: { id, inputVersion: expected },
      data: { ...data, inputVersion: { increment: 1 }, turnCount: { increment: 1 }, status: 'ASSESSING', version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new AppException(HttpStatus.CONFLICT, 'STALE_INPUT', 'This check was updated somewhere else. Please refresh.', true);
    }
    return expected + 1;
  }

  private async enqueue(tx: Db, principal: AuthPrincipal, sessionId: string, inputVersion: number, extra: Record<string, unknown>) {
    await tx.outboxJob.create({
      data: { tenantId: principal.tenantId, type: ASSESS_JOB, resourceId: sessionId, payload: { inputVersion, ...extra } },
    });
    await this.store.event(tx, sessionId, 'queued', { inputVersion });
  }

  private answerState(facts: FactMap) {
    const states = Object.values(facts).map((f) => f.state);
    if (states.includes('PRESENT')) return 'PRESENT' as const;
    if (states.includes('DECLINED')) return 'DECLINED' as const;
    if (states.includes('UNKNOWN')) return 'UNKNOWN' as const;
    return 'ABSENT' as const;
  }

  private async profileFacts(principal: AuthPrincipal): Promise<FactMap> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { tenantId_userId: { tenantId: principal.tenantId, userId: principal.userId } },
    });
    const facts: FactMap = {};
    if (profile?.dateOfBirth) {
      const now = new Date();
      const dob = profile.dateOfBirth;
      let age = now.getUTCFullYear() - dob.getUTCFullYear();
      if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1;
      facts.age = { state: 'PRESENT', value: age, source: 'profile' };
    }
    if (profile?.pregnancyStatus === 'PREGNANT') facts.pregnant = { state: 'PRESENT', source: 'profile' };
    return facts;
  }
}

const TITLE_MAX = 60;

function shortTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const end = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  return `${(end > 20 ? cut.slice(0, end) : cut).replace(/[,.;:\s]+$/, '')}…`;
}
