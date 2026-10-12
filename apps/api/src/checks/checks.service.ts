import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { BundleContent, QuestionDef } from '../clinical/bundle.schema.js';
import { historyFacts, type ProfileList } from '../memory/history-facts.js';
import { detectConcerns, type FactMap, planQuestions, presentQuestion, QUESTION_REASON_TEXT } from '../clinical/rules-engine.js';
import { AppException } from '../common/app.exception.js';
import { ConsentService } from '../consent/consent.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ResultContent } from '../assessment/result.types.js';
import { type AnswerValue, InvalidAnswerError, mapAnswer } from './answer-mapping.js';
import { CaseStore, type Db } from './case-store.js';
import { buildDoctorSummary, type DoctorSummary } from './doctor-summary.js';

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
  /** Why Nora is asking this now. */
  reason: string | null;
  /** What Nora still plans to check after this question; it shrinks or grows with the answers. */
  stillToCover: string[];
  /** The earlier check this question refers to, when it asks how the two relate. */
  earlierCheck: { id: string; title: string | null; createdAt: string; advice: string | null } | null;
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
  review: {
    status: 'pending' | 'reviewed' | 'corrected';
    clinician: string | null;
    correctedUrgency: string | null;
    patientNote: string | null;
    reviewedAt: string | null;
  } | null;
  /** Care-plan items the patient marked done (logistics only; never changes urgency). */
  carePlanDone: string[];
  /** The earlier check this one follows up, as it was when it finished. */
  parent: { id: string; title: string | null; createdAt: string; urgency: string | null; urgencyTitle: string | null; summary: string | null } | null;
}

const ACTIVE = ['DRAFT', 'COLLECTING'] as const;

@Injectable()
export class ChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CaseStore,
    private readonly consent: ConsentService,
  ) {}

  async create(principal: AuthPrincipal, idempotencyKey: string, parentId?: string): Promise<CheckView> {
    const existing = await this.prisma.assessmentSession.findUnique({
      where: { tenantId_patientUserId_idempotencyKey: { tenantId: principal.tenantId, patientUserId: principal.userId, idempotencyKey } },
    });
    if (existing) return this.view(principal, existing.id);
    if (parentId) {
      const parent = await this.owned(principal, parentId);
      if ((ACTIVE as readonly string[]).includes(parent.status) || parent.status === 'ASSESSING') {
        throw new AppException(HttpStatus.CONFLICT, 'PARENT_NOT_FINISHED', 'Finish the earlier check before starting a follow-up.');
      }
    }

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

    const prefill = await this.profileFacts(principal, await this.store.bundle(tenant.activeBundleId));
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assessmentSession.create({
        data: {
          tenantId: principal.tenantId,
          patientUserId: principal.userId,
          bundleId: tenant.activeBundleId!,
          status: 'COLLECTING',
          idempotencyKey,
          parentSessionId: parentId ?? null,
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
      select: { id: true, title: true, status: true, urgency: true, createdAt: true, updatedAt: true, currentResultId: true, parentSessionId: true },
    });
    const resultIds = rows.map((r) => r.currentResultId).filter((x): x is string => !!x);
    const results = await this.prisma.assessmentResult.findMany({ where: { id: { in: resultIds } }, select: { id: true, reviewStatus: true } });
    return rows.map(({ currentResultId, ...r }) => ({
      ...r,
      reviewStatus: results.find((x) => x.id === currentResultId)?.reviewStatus ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
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
    const [bundle, facts] = await Promise.all([this.store.bundle(session.bundleId), this.store.facts(this.prisma, id)]);
    const defined = bundle.questions[questionId];
    if (!defined) throw new AppException(HttpStatus.BAD_REQUEST, 'UNKNOWN_QUESTION', 'This question is not part of the check.');
    const question = presentQuestion(defined, facts);

    let mapped;
    try {
      mapped = mapAnswer(question, value);
    } catch (error) {
      if (error instanceof InvalidAnswerError) throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_ANSWER', error.message);
      throw error;
    }

    const written = mapped.written === true;
    await this.prisma.$transaction(async (tx) => {
      const next = await this.bumpInput(tx, session.id, session.inputVersion, { pendingQuestionId: null });
      await tx.answer.updateMany({ where: { sessionId: id, questionId, supersededAt: null }, data: { supersededAt: new Date() } });
      await tx.answer.create({
        data: {
          sessionId: id,
          questionId,
          state: written ? 'PRESENT' : this.answerState(mapped.facts),
          value: (value ?? Prisma.DbNull) as Prisma.InputJsonValue,
          inputVersion: next,
        },
      });
      await this.store.writeFacts(tx, id, mapped.facts, next);
      const message = await tx.message.create({
        data: { sessionId: id, sender: 'patient', kind: written ? 'text' : 'answer', text: mapped.label, questionId, inputVersion: next },
      });
      await this.enqueue(tx, principal, id, next, written ? { messageId: message.id } : {});
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
    const [messages, result, lastEvent, tenantCtx, bundle, reviewTask] = await Promise.all([
      this.prisma.message.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } }),
      session.currentResultId ? this.prisma.assessmentResult.findUnique({ where: { id: session.currentResultId } }) : null,
      this.prisma.sessionEvent.findFirst({ where: { sessionId: id }, orderBy: { sequence: 'desc' }, select: { sequence: true } }),
      this.store.tenantContext(principal.tenantId),
      this.store.bundle(session.bundleId),
      session.currentResultId
        ? this.prisma.reviewTask.findUnique({ where: { resultId: session.currentResultId }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } })
        : null,
    ]);
    const decision = reviewTask?.decisions[0];
    const [reviewer, acks, parent] = await Promise.all([
      decision ? this.prisma.user.findUnique({ where: { id: decision.clinicianId }, select: { displayName: true } }) : null,
      session.currentResultId ? this.prisma.taskAcknowledgement.findMany({ where: { resultId: session.currentResultId }, select: { itemId: true } }) : [],
      session.parentSessionId ? this.parentSnapshot(principal, session.parentSessionId) : null,
    ]);
    const reviewVisible = !!reviewTask && (!!decision || (await this.consent.hasGranted(principal.tenantId, principal.userId, 'CLINICIAN_SHARING')));
    const defined = session.pendingQuestionId ? bundle.questions[session.pendingQuestionId] : undefined;
    const facts = defined ? await this.store.facts(this.prisma, id) : {};
    const q = defined ? presentQuestion(defined, facts) : undefined;
    const plan = defined ? planQuestions(bundle, facts, detectConcerns(bundle, facts), new Set(await this.store.askedQuestions(this.prisma, id))) : [];
    const reason = plan.find((p) => p.id === session.pendingQuestionId)?.reason ?? null;
    const earlierCheck = session.pendingQuestionId && session.pendingQuestionId === bundle.episodeQuestion ? await this.earlierCheck(session, bundle) : null;
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
            reason: reason ? QUESTION_REASON_TEXT[reason] : null,
            stillToCover: [...new Set(plan.filter((p) => p.id !== session.pendingQuestionId).map((p) => QUESTION_REASON_TEXT[p.reason]))],
            earlierCheck,
          }
        : null,
      result: result
        ? { ...(result.content as unknown as ResultContent), createdAt: result.createdAt.toISOString() }
        : null,
      lastEventSequence: (lastEvent?.sequence ?? 0n).toString(),
      emergency: tenantCtx.emergency,
      review: reviewVisible
        ? {
            status: !decision ? 'pending' : decision.correctedUrgency ? 'corrected' : 'reviewed',
            clinician: reviewer?.displayName ?? null,
            correctedUrgency: decision?.correctedUrgency ?? null,
            patientNote: decision?.patientNote ?? null,
            reviewedAt: decision?.createdAt.toISOString() ?? null,
          }
        : null,
      carePlanDone: acks.map((a) => a.itemId),
      parent,
    };
  }

  /** A doctor-ready summary of a finished check, built from the saved result and the patient's profile. */
  async doctorSummary(principal: AuthPrincipal, id: string): Promise<DoctorSummary> {
    const check = await this.view(principal, id);
    if (!check.result) {
      throw new AppException(HttpStatus.CONFLICT, 'SUMMARY_NOT_READY', 'Finish the check first. The summary is available once Nora has given its advice.');
    }
    const session = await this.owned(principal, id);
    const [bundle, profile, user] = await Promise.all([
      this.store.bundle(session.bundleId),
      this.prisma.patientProfile.findUnique({ where: { tenantId_userId: { tenantId: principal.tenantId, userId: principal.userId } } }),
      this.prisma.user.findUnique({ where: { id: principal.userId }, select: { displayName: true } }),
    ]);
    const { createdAt: assessedAt, ...result } = check.result;
    const replies = new Map<string, { text: string; written: boolean }>();
    for (const m of check.messages) if (m.sender === 'patient' && m.questionId) replies.set(m.questionId, { text: m.text, written: m.kind === 'text' });
    const asked = [...new Set(check.messages.filter((m) => m.sender === 'nora' && m.kind === 'question' && m.questionId).map((m) => m.questionId!))];
    const closing = bundle.closingQuestion;
    const closingReply = closing ? replies.get(closing) : undefined;
    return buildDoctorSummary({
      checkId: id,
      createdAt: session.createdAt,
      assessedAt: new Date(assessedAt),
      answers: asked
        .filter((q) => q !== closing && replies.has(q))
        .map((q) => ({ question: bundle.questions[q]?.text ?? q, answer: replies.get(q)!.text })),
      additional: closingReply?.written ? [closingReply.text] : [],
      patient: {
        name: user?.displayName ?? null,
        age: profile?.dateOfBirth ? ageOn(profile.dateOfBirth, session.createdAt) : null,
        sexAtBirth: profile?.sexAtBirth && profile.sexAtBirth !== 'UNKNOWN' ? profile.sexAtBirth : null,
      },
      profile: profile
        ? { conditions: profile.conditions as ProfileList | null, medications: profile.medications as ProfileList | null, allergies: profile.allergies as ProfileList | null }
        : null,
      ownWords: check.messages.filter((m) => m.sender === 'patient' && m.kind === 'text' && !m.questionId).map((m) => m.text),
      result,
      review: check.review,
      urgencyTitles: Object.fromEntries(Object.entries(bundle.urgencyActions).map(([k, v]) => [k, v.title])),
      now: new Date(),
    });
  }

  /** Marks a care-plan item done or not done. Purely logistical: urgency and the result are untouched. */
  async acknowledge(principal: AuthPrincipal, id: string, itemId: string, done: boolean): Promise<CheckView> {
    const session = await this.owned(principal, id);
    const result = session.currentResultId ? await this.prisma.assessmentResult.findUnique({ where: { id: session.currentResultId } }) : null;
    const content = result?.content as unknown as ResultContent | undefined;
    if (!result || !content?.carePlan.some((i) => i.id === itemId)) {
      throw new AppException(HttpStatus.NOT_FOUND, 'CARE_ITEM_NOT_FOUND', 'This care-plan item could not be found.');
    }
    if (done) {
      await this.prisma.taskAcknowledgement.upsert({
        where: { resultId_itemId: { resultId: result.id, itemId } },
        update: {},
        create: { resultId: result.id, itemId, userId: principal.userId },
      });
    } else {
      await this.prisma.taskAcknowledgement.deleteMany({ where: { resultId: result.id, itemId } });
    }
    return this.view(principal, id);
  }

  /** The most recent finished check for the same problem inside the bundle's recurrence window, as the assessment sees it. */
  private async earlierCheck(
    session: { id: string; tenantId: string; patientUserId: string; parentSessionId: string | null; concernCode: string | null; createdAt: Date },
    bundle: BundleContent,
  ): Promise<QuestionView['earlierCheck']> {
    if (!session.concernCode) return null;
    const earlier = await this.prisma.assessmentSession.findFirst({
      where: {
        tenantId: session.tenantId,
        patientUserId: session.patientUserId,
        concernCode: session.concernCode,
        status: { in: ['COMPLETED', 'INCOMPLETE', 'ESCALATED'] },
        currentResultId: { not: null },
        createdAt: { gte: new Date(Date.now() - bundle.meta.recurrenceDays * 86_400_000) },
        id: { notIn: [session.id, ...(session.parentSessionId ? [session.parentSessionId] : [])] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true, currentResultId: true },
    });
    if (!earlier) return null;
    const result = await this.prisma.assessmentResult.findUnique({ where: { id: earlier.currentResultId! }, select: { content: true } });
    const content = result?.content as unknown as ResultContent | undefined;
    return { id: earlier.id, title: earlier.title, createdAt: earlier.createdAt.toISOString(), advice: content?.urgency.title ?? null };
  }

  private async parentSnapshot(principal: AuthPrincipal, parentId: string): Promise<CheckView['parent']> {
    const parent = await this.prisma.assessmentSession.findFirst({
      where: { id: parentId, tenantId: principal.tenantId, patientUserId: principal.userId },
      select: { id: true, title: true, createdAt: true, urgency: true, currentResultId: true },
    });
    if (!parent) return null;
    const result = parent.currentResultId ? await this.prisma.assessmentResult.findUnique({ where: { id: parent.currentResultId }, select: { content: true } }) : null;
    const content = result?.content as unknown as ResultContent | undefined;
    return {
      id: parent.id,
      title: parent.title,
      createdAt: parent.createdAt.toISOString(),
      urgency: content?.urgency.level ?? parent.urgency,
      urgencyTitle: content?.urgency.title ?? null,
      summary: content?.summary ?? null,
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
    if (states.length === 0) return 'DECLINED' as const;
    if (states.includes('PRESENT')) return 'PRESENT' as const;
    if (states.includes('DECLINED')) return 'DECLINED' as const;
    if (states.includes('UNKNOWN')) return 'UNKNOWN' as const;
    return 'ABSENT' as const;
  }

  /** Age, pregnancy and long-term history from the profile; symptoms always start empty for a new consultation. */
  private async profileFacts(principal: AuthPrincipal, bundle: BundleContent): Promise<FactMap> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { tenantId_userId: { tenantId: principal.tenantId, userId: principal.userId } },
    });
    const facts: FactMap = profile ? historyFacts(bundle, profile.conditions as ProfileList | null, profile.medications as ProfileList | null) : {};
    if (profile?.dateOfBirth) facts.age = { state: 'PRESENT', value: ageOn(profile.dateOfBirth, new Date()), source: 'profile' };
    if (profile?.pregnancyStatus === 'PREGNANT') facts.pregnant = { state: 'PRESENT', source: 'profile' };
    return facts;
  }
}

function ageOn(dob: Date, on: Date) {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  if (on.getUTCMonth() < dob.getUTCMonth() || (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

const TITLE_MAX = 60;

function shortTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const end = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  return `${(end > 20 ? cut.slice(0, end) : cut).replace(/[,.;:\s]+$/, '')}…`;
}
