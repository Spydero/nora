import type { Prisma } from '../generated/prisma/client.js';

export const ASSESS_JOB = 'assess';

export type StopReason = 'consent_withdrawn' | 'assessment_disabled';

export const STOPPED_TEXT: Record<StopReason, string> = {
  consent_withdrawn:
    'Nora stopped working on this check because you withdrew consent for Nora to process your health information. Nothing more from it was assessed. If you feel very unwell, do not wait — contact emergency services.',
  assessment_disabled:
    'Symptom checks were switched off, so Nora stopped working on this check. Nothing more from it was assessed. If you feel unwell, contact a doctor. If you feel very unwell, do not wait — contact emergency services.',
};

/**
 * Cancels a patient's queued assessment work and hands any check that was
 * waiting on it back to the patient. Nothing from the cancelled work is
 * written: no facts, questions or results.
 */
export async function stopQueuedAssessments(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; userId: string; sessionIds?: string[] },
  reason: StopReason,
): Promise<string[]> {
  const sessions = await tx.assessmentSession.findMany({
    where: { tenantId: scope.tenantId, patientUserId: scope.userId, ...(scope.sessionIds ? { id: { in: scope.sessionIds } } : {}) },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  if (!ids.length) return [];
  await tx.outboxJob.updateMany({
    where: { tenantId: scope.tenantId, type: ASSESS_JOB, resourceId: { in: ids }, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'CANCELLED', lastError: reason, lockedAt: null, completedAt: new Date() },
  });
  const waiting = await tx.assessmentSession.findMany({ where: { id: { in: ids }, status: 'ASSESSING' }, select: { id: true, inputVersion: true } });
  for (const s of waiting) {
    const updated = await tx.assessmentSession.updateMany({ where: { id: s.id, status: 'ASSESSING' }, data: { status: 'COLLECTING', version: { increment: 1 } } });
    if (updated.count !== 1) continue;
    await tx.message.create({ data: { sessionId: s.id, sender: 'nora', kind: 'notice', text: STOPPED_TEXT[reason], inputVersion: s.inputVersion } });
    await tx.sessionEvent.create({ data: { sessionId: s.id, type: 'error', payload: { reason } } });
  }
  return waiting.map((s) => s.id);
}
