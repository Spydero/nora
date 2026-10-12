import { Injectable } from '@nestjs/common';
import type { ResultContent } from '../assessment/result.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MemoryItem, MemoryKind } from './memory.types.js';

const PAST_CHECK_DAYS = 90;
const PAST_CHECK_LIMIT = 10;
const FINISHED = ['COMPLETED', 'INCOMPLETE', 'ESCALATED'] as const;

const URGENCY_TEXT: Record<string, string> = {
  emergency: 'get emergency help',
  urgent: 'see a doctor the same day',
  soon: 'see a doctor within 24–48 hours',
  routine: 'book a routine appointment',
  self_care: 'look after yourself at home',
};

const dateText = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(d);
const dateTimeText = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d);

type Draft = Omit<MemoryItem, 'id'>;

/**
 * Deterministic patient memory. Every item quotes a stored record (profile,
 * a finished check and its review, or an appointment the patient added), so
 * anything an AI draft says about the patient's history can be traced to it.
 */
@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** `includeCheckId` (the check being followed up) is always included, however old it is. */
  async forPatient(tenantId: string, userId: string, opts: { excludeSessionId?: string; includeCheckId?: string | null; now?: Date } = {}): Promise<MemoryItem[]> {
    const now = opts.now ?? new Date();
    const finished = { tenantId, patientUserId: userId, status: { in: [...FINISHED] }, currentResultId: { not: null } };
    const select = { id: true, title: true, concernCode: true, createdAt: true, currentResultId: true } as const;
    const [profile, recent, included, appointments] = await Promise.all([
      this.prisma.patientProfile.findUnique({ where: { tenantId_userId: { tenantId, userId } } }),
      this.prisma.assessmentSession.findMany({
        where: {
          ...finished,
          createdAt: { gte: new Date(now.getTime() - PAST_CHECK_DAYS * 86_400_000) },
          ...(opts.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: PAST_CHECK_LIMIT,
        select,
      }),
      opts.includeCheckId && opts.includeCheckId !== opts.excludeSessionId
        ? this.prisma.assessmentSession.findFirst({ where: { ...finished, id: opts.includeCheckId }, select })
        : null,
      this.prisma.patientReportedAppointment.findMany({
        where: { tenantId, patientUserId: userId, scheduledAt: { gte: now }, status: 'PATIENT_REPORTED' },
        orderBy: { scheduledAt: 'asc' },
        take: 3,
      }),
    ]);
    const sessions = included && !recent.some((s) => s.id === included.id) ? [...recent, included] : recent;

    const items: Draft[] = [];
    if (profile) {
      if (profile.sexAtBirth !== 'UNKNOWN') {
        items.push({ kind: 'about', label: 'Sex at birth', text: profile.sexAtBirth.toLowerCase(), recordedAt: profile.updatedAt.toISOString(), href: '/settings' });
      }
      const lists: [MemoryKind, string, unknown][] = [
        ['condition', 'Known condition', profile.conditions],
        ['medicine', 'Current medicine', profile.medications],
        ['allergy', 'Allergy', profile.allergies],
      ];
      for (const [kind, label, value] of lists) {
        const list = value as { state?: string; items?: string[] } | null;
        if (list?.state !== 'known') continue;
        for (const text of list.items ?? []) items.push({ kind, label, text, recordedAt: profile.updatedAt.toISOString(), href: '/settings' });
      }
    }

    const resultIds = sessions.map((s) => s.currentResultId!);
    const [results, reviews] = await Promise.all([
      this.prisma.assessmentResult.findMany({ where: { id: { in: resultIds } }, select: { id: true, content: true } }),
      this.prisma.reviewTask.findMany({
        where: { resultId: { in: resultIds } },
        select: { resultId: true, decisions: { orderBy: { createdAt: 'desc' }, take: 1, select: { correctedUrgency: true } } },
      }),
    ]);
    for (const s of sessions) {
      const content = results.find((r) => r.id === s.currentResultId)?.content as unknown as ResultContent | undefined;
      if (!content) continue;
      const decision = reviews.find((r) => r.resultId === s.currentResultId)?.decisions[0];
      const raw = (content.concerns[0]?.label ?? s.title ?? 'a symptom check').replace(/[\s.!?,;:]+$/u, '');
      const what = raw.endsWith('…') ? raw.slice(0, -1) : raw;
      const advice =
        content.status === 'UNSUPPORTED' ? 'Nora could not assess this and suggested speaking with a doctor' : `Nora advised: ${URGENCY_TEXT[content.urgency.level] ?? content.urgency.title.toLowerCase()}`;
      const review = decision ? (decision.correctedUrgency ? `; a clinician changed this to: ${URGENCY_TEXT[decision.correctedUrgency]}` : '; a clinician agreed') : '';
      items.push({
        kind: 'past_check',
        label: 'Earlier check',
        text: `${dateText(s.createdAt)} — ${what}${raw.endsWith('…') ? '…' : '.'} ${advice}${review}.`,
        recordedAt: s.createdAt.toISOString(),
        href: `/history`,
        checkId: s.id,
        concernCode: s.concernCode,
        urgency: content.status === 'UNSUPPORTED' ? null : (decision?.correctedUrgency ?? content.urgency.level),
      });
    }

    if (appointments.length) {
      const providers = await this.prisma.provider.findMany({
        where: { id: { in: appointments.map((a) => a.providerId) } },
        select: { id: true, name: true, specialties: true },
      });
      for (const a of appointments) {
        const p = providers.find((x) => x.id === a.providerId);
        items.push({
          kind: 'appointment',
          label: 'Upcoming appointment (you added this)',
          text: `${p ? `${p.name}${p.specialties[0] ? `, ${p.specialties[0]}` : ''}` : 'A doctor'} on ${dateTimeText(a.scheduledAt)}`,
          recordedAt: a.createdAt.toISOString(),
          href: '/appointments',
        });
      }
    }

    return items.map((item, i) => ({ id: `M${i + 1}`, ...item }));
  }
}
