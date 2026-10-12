import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ResultContent } from '../assessment/result.types.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CaseStore } from '../checks/case-store.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

const URGENCY = ['self_care', 'routine', 'soon', 'urgent', 'emergency'] as const;

export const reviewQuerySchema = z.object({ status: z.enum(['open', 'done']).default('open') });
export const versionSchema = z.object({ version: z.number().int().min(0) });
export const decisionSchema = z
  .object({
    version: z.number().int().min(0),
    decision: z.enum(['AGREE', 'CHANGE_URGENCY']),
    correctedUrgency: z.enum(URGENCY).optional(),
    reason: z.string().trim().min(3, 'Give a short clinical reason').max(1000),
    patientNote: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.decision !== 'CHANGE_URGENCY' || d.correctedUrgency, { path: ['correctedUrgency'], message: 'Choose the corrected urgency' });

const OPEN = ['QUEUED', 'IN_REVIEW'];

function ageFrom(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly store: CaseStore,
  ) {}

  private async requireEnabled(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { capabilities: true } });
    if (!tenant.capabilities.includes('clinician_review')) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CAPABILITY_DISABLED', 'Clinician review is turned off for this organisation.');
    }
  }

  /** Patients whose latest CLINICIAN_SHARING consent is a grant. Withdrawal hides their cases from the queue. */
  private async sharingPatients(tenantId: string, userIds: string[]): Promise<Set<string>> {
    const records = await this.prisma.consentRecord.findMany({
      where: { tenantId, purpose: 'CLINICIAN_SHARING', subjectUserId: { in: [...new Set(userIds)] } },
      orderBy: { createdAt: 'desc' },
      select: { subjectUserId: true, action: true },
    });
    const latest = new Map<string, string>();
    for (const r of records) if (!latest.has(r.subjectUserId)) latest.set(r.subjectUserId, r.action);
    return new Set([...latest].filter(([, action]) => action === 'GRANTED').map(([id]) => id));
  }

  private async assertShared(tenantId: string, sessionId: string): Promise<string> {
    const session = await this.prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId }, select: { patientUserId: true } });
    if (!(await this.sharingPatients(tenantId, [session.patientUserId])).has(session.patientUserId)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'SHARING_NOT_ALLOWED', 'This patient has not agreed to share their checks with clinicians.');
    }
    return session.patientUserId;
  }

  /** Open and overdue tasks that clinicians can actually see, matching the queue. */
  async openCounts(tenantId: string): Promise<{ open: number; overdue: number }> {
    const tasks = await this.prisma.reviewTask.findMany({ where: { tenantId, status: { in: OPEN } }, select: { sessionId: true, dueAt: true } });
    const sessions = await this.prisma.assessmentSession.findMany({ where: { id: { in: tasks.map((t) => t.sessionId) } }, select: { id: true, patientUserId: true } });
    const sharing = await this.sharingPatients(tenantId, sessions.map((s) => s.patientUserId));
    const visible = new Set(sessions.filter((s) => sharing.has(s.patientUserId)).map((s) => s.id));
    const shown = tasks.filter((t) => visible.has(t.sessionId));
    const now = Date.now();
    return { open: shown.length, overdue: shown.filter((t) => t.dueAt.getTime() < now).length };
  }

  async list(principal: AuthPrincipal, status: 'open' | 'done') {
    await this.requireEnabled(principal.tenantId);
    const tasks = await this.prisma.reviewTask.findMany({
      where: { tenantId: principal.tenantId, status: status === 'open' ? { in: OPEN } : 'DONE' },
      orderBy: status === 'open' ? { dueAt: 'asc' } : { updatedAt: 'desc' },
      take: 100,
    });
    const allSessions = await this.prisma.assessmentSession.findMany({ where: { id: { in: tasks.map((t) => t.sessionId) } } });
    const sharing = await this.sharingPatients(principal.tenantId, allSessions.map((s) => s.patientUserId));
    const sessions = allSessions.filter((s) => sharing.has(s.patientUserId));
    const userIds = [...new Set([...sessions.map((s) => s.patientUserId), ...tasks.map((t) => t.assigneeId).filter((a): a is string => !!a)])];
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
      this.prisma.patientProfile.findMany({ where: { tenantId: principal.tenantId, userId: { in: userIds } }, select: { userId: true, dateOfBirth: true } }),
    ]);
    const name = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? null;
    const now = Date.now();
    const rank = (u: string | null) => URGENCY.indexOf((u ?? 'self_care') as (typeof URGENCY)[number]);
    return tasks
      .filter((t) => sessions.some((s) => s.id === t.sessionId))
      .map((t) => {
        const s = sessions.find((x) => x.id === t.sessionId);
        return {
          id: t.id,
          status: t.status,
          version: t.version,
          reasons: t.reason.split(','),
          dueAt: t.dueAt.toISOString(),
          overdue: OPEN.includes(t.status) && t.dueAt.getTime() < now,
          createdAt: t.createdAt.toISOString(),
          assignee: t.assigneeId ? { id: t.assigneeId, name: name(t.assigneeId), isMe: t.assigneeId === principal.userId } : null,
          check: { id: t.sessionId, title: s?.title ?? null, urgency: s?.urgency ?? null, status: s?.status ?? null },
          patient: { name: name(s?.patientUserId ?? null), age: ageFrom(profiles.find((p) => p.userId === s?.patientUserId)?.dateOfBirth) },
        };
      })
      .sort((a, b) => (status === 'open' ? rank(b.check.urgency) - rank(a.check.urgency) || a.dueAt.localeCompare(b.dueAt) : 0));
  }

  /** Opening a case is a protected read of patient data, so it is always audited. */
  async get(principal: AuthPrincipal, id: string) {
    await this.requireEnabled(principal.tenantId);
    const task = await this.prisma.reviewTask.findFirst({ where: { id, tenantId: principal.tenantId }, include: { decisions: { orderBy: { createdAt: 'asc' } } } });
    if (!task) throw new AppException(HttpStatus.NOT_FOUND, 'REVIEW_NOT_FOUND', 'This review task could not be found.');
    await this.assertShared(principal.tenantId, task.sessionId);
    const session = await this.prisma.assessmentSession.findUniqueOrThrow({
      where: { id: task.sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } }, urgencyDecisions: { orderBy: { createdAt: 'asc' } } },
    });
    const [result, patient, profile, facts, clinicians] = await Promise.all([
      this.prisma.assessmentResult.findUniqueOrThrow({ where: { id: task.resultId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: session.patientUserId }, select: { displayName: true } }),
      this.prisma.patientProfile.findUnique({ where: { tenantId_userId: { tenantId: principal.tenantId, userId: session.patientUserId } } }),
      this.prisma.caseFact.findMany({ where: { sessionId: session.id, supersededAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findMany({ where: { id: { in: [...task.decisions.map((d) => d.clinicianId), ...(task.assigneeId ? [task.assigneeId] : [])] } }, select: { id: true, displayName: true } }),
    ]);
    const bundle = await this.store.bundle(session.bundleId);
    await this.audit.record(principal, {
      action: 'review.case.read',
      resourceType: 'assessment_session',
      resourceId: session.id,
      subjectUserId: session.patientUserId,
      purpose: 'clinical_review',
      metadata: { reviewTaskId: task.id },
    });
    const clinicianName = (id: string | null) => clinicians.find((c) => c.id === id)?.displayName ?? null;
    const list = (v: unknown) => {
      const l = v as { state?: string; items?: string[] } | null;
      return l?.state === 'known' ? (l.items ?? []).join(', ') : l?.state === 'none' ? 'None' : 'Not recorded';
    };
    return {
      id: task.id,
      status: task.status,
      version: task.version,
      reasons: task.reason.split(','),
      dueAt: task.dueAt.toISOString(),
      assignee: task.assigneeId ? { id: task.assigneeId, name: clinicianName(task.assigneeId), isMe: task.assigneeId === principal.userId } : null,
      patient: {
        name: patient.displayName,
        age: ageFrom(profile?.dateOfBirth),
        sexAtBirth: profile?.sexAtBirth ?? 'UNKNOWN',
        pregnancyStatus: profile?.pregnancyStatus ?? 'UNKNOWN',
        conditions: list(profile?.conditions),
        medications: list(profile?.medications),
        allergies: list(profile?.allergies),
      },
      check: { id: session.id, title: session.title, status: session.status, urgency: session.urgency, createdAt: session.createdAt.toISOString() },
      messages: session.messages.map((m) => ({ id: m.id, sender: m.sender, kind: m.kind, text: m.text, createdAt: m.createdAt.toISOString() })),
      facts: facts.map((f) => ({
        key: f.key,
        label: bundle.facts[f.key]?.label ?? f.key,
        state: f.state,
        value: typeof f.value === 'number' ? f.value : null,
        unit: bundle.facts[f.key]?.unit ?? null,
        source: f.source,
        quote: f.quote,
      })),
      urgencyHistory: session.urgencyDecisions.map((u) => ({ level: u.level, source: u.source, ruleIds: u.ruleIds, reason: u.reason, createdAt: u.createdAt.toISOString() })),
      result: { ...(result.content as unknown as ResultContent), createdAt: result.createdAt.toISOString(), reviewStatus: result.reviewStatus },
      decisions: task.decisions.map((d) => ({
        id: d.id,
        decision: d.decision,
        reason: d.reason,
        correctedUrgency: d.correctedUrgency,
        patientNote: d.patientNote,
        clinician: clinicianName(d.clinicianId),
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  async claim(principal: AuthPrincipal, id: string, version: number, release = false) {
    await this.requireEnabled(principal.tenantId);
    const existing = await this.prisma.reviewTask.findFirst({ where: { id, tenantId: principal.tenantId }, select: { sessionId: true } });
    if (!existing) throw new AppException(HttpStatus.NOT_FOUND, 'REVIEW_NOT_FOUND', 'This review task could not be found.');
    const patientUserId = await this.assertShared(principal.tenantId, existing.sessionId);
    const updated = await this.prisma.reviewTask.updateMany({
      where: {
        id,
        tenantId: principal.tenantId,
        version,
        status: { in: OPEN },
        ...(release ? { assigneeId: principal.userId } : {}),
      },
      data: release ? { assigneeId: null, status: 'QUEUED', version: { increment: 1 } } : { assigneeId: principal.userId, status: 'IN_REVIEW', version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new AppException(HttpStatus.CONFLICT, 'REVIEW_CHANGED', 'Someone else updated this case. Reload to see the latest.', true);
    await this.audit.record(principal, {
      action: release ? 'review.release' : 'review.claim',
      resourceType: 'review_task',
      resourceId: id,
      subjectUserId: patientUserId,
      purpose: 'clinical_review',
    });
    return this.get(principal, id);
  }

  async decide(principal: AuthPrincipal, id: string, input: z.infer<typeof decisionSchema>) {
    await this.requireEnabled(principal.tenantId);
    const existing = await this.prisma.reviewTask.findFirst({ where: { id, tenantId: principal.tenantId }, select: { sessionId: true } });
    if (!existing) throw new AppException(HttpStatus.NOT_FOUND, 'REVIEW_NOT_FOUND', 'This review task could not be found.');
    await this.assertShared(principal.tenantId, existing.sessionId);
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.reviewTask.findFirst({ where: { id, tenantId: principal.tenantId } });
      if (!task) throw new AppException(HttpStatus.NOT_FOUND, 'REVIEW_NOT_FOUND', 'This review task could not be found.');
      const claimed = await tx.reviewTask.updateMany({
        where: { id, version: input.version, status: { in: OPEN }, OR: [{ assigneeId: null }, { assigneeId: principal.userId }] },
        data: { status: 'DONE', assigneeId: principal.userId, version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new AppException(HttpStatus.CONFLICT, 'REVIEW_CHANGED', 'Someone else updated this case. Reload to see the latest.', true);

      const changing = input.decision === 'CHANGE_URGENCY';
      await tx.clinicalDecision.create({
        data: {
          reviewTaskId: id,
          resultId: task.resultId,
          clinicianId: principal.userId,
          decision: input.decision,
          reason: input.reason,
          correctedUrgency: changing ? input.correctedUrgency : null,
          patientNote: input.patientNote || null,
        },
      });
      await tx.assessmentResult.update({ where: { id: task.resultId }, data: { reviewStatus: changing ? 'CORRECTED' : 'REVIEWED' } });

      const session = await tx.assessmentSession.findUniqueOrThrow({ where: { id: task.sessionId } });
      if (changing) {
        await tx.urgencyDecision.create({
          data: {
            sessionId: session.id,
            inputVersion: session.inputVersion,
            level: input.correctedUrgency!,
            ruleIds: [],
            bundleId: session.bundleId,
            source: 'CLINICIAN',
            reason: input.reason,
            actorUserId: principal.userId,
          },
        });
        await tx.assessmentSession.update({ where: { id: session.id }, data: { urgency: input.correctedUrgency } });
      }
      const note = input.patientNote?.trim();
      await tx.message.create({
        data: {
          sessionId: session.id,
          sender: 'nora',
          kind: 'review',
          text: note || (changing ? 'A clinician reviewed your check and updated how soon you should get care.' : 'A clinician reviewed your check and agreed with the advice.'),
          inputVersion: session.inputVersion,
        },
      });
      await this.store.event(tx, session.id, 'reviewed', { decision: input.decision });
      await this.audit.record(
        principal,
        { action: 'review.decision', resourceType: 'review_task', resourceId: id, subjectUserId: session.patientUserId, purpose: 'clinical_review', metadata: { decision: input.decision } },
        tx,
      );
    });
    return this.get(principal, id);
  }
}
