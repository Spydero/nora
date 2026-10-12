import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import type { ConsentPurpose } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { stopQueuedAssessments } from './processing-stop.js';

export interface ConsentState {
  purpose: ConsentPurpose;
  noticeVersionId: string;
  version: string;
  title: string;
  body: string;
  required: boolean;
  granted: boolean;
  updatedAt: string | null;
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current notice per purpose for the tenant, with the subject's latest decision. */
  async list(principal: AuthPrincipal): Promise<ConsentState[]> {
    const notices = await this.currentNotices(principal.tenantId);
    const records = await this.prisma.consentRecord.findMany({
      where: { tenantId: principal.tenantId, subjectUserId: principal.userId },
      orderBy: { createdAt: 'desc' },
    });
    return notices.map((n) => {
      const latest = records.find((r) => r.purpose === n.purpose);
      return {
        purpose: n.purpose,
        noticeVersionId: n.id,
        version: n.version,
        title: n.title,
        body: n.body,
        required: n.required,
        granted: latest?.action === 'GRANTED',
        updatedAt: latest?.createdAt.toISOString() ?? null,
      };
    });
  }

  async record(principal: AuthPrincipal, purpose: ConsentPurpose, granted: boolean): Promise<ConsentState[]> {
    const notice = (await this.currentNotices(principal.tenantId)).find((n) => n.purpose === purpose);
    if (!notice) throw new AppException(HttpStatus.NOT_FOUND, 'NOTICE_NOT_FOUND', 'There is no notice for this purpose.');
    await this.prisma.$transaction(async (tx) => {
      await tx.consentRecord.create({
        data: {
          tenantId: principal.tenantId,
          subjectUserId: principal.userId,
          actorUserId: principal.userId,
          purpose,
          action: granted ? 'GRANTED' : 'WITHDRAWN',
          noticeVersionId: notice.id,
        },
      });
      if (purpose === 'PROCESSING' && !granted) await stopQueuedAssessments(tx, { tenantId: principal.tenantId, userId: principal.userId }, 'consent_withdrawn');
    });
    return this.list(principal);
  }

  async hasGranted(tenantId: string, userId: string, purpose: ConsentPurpose): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { tenantId, subjectUserId: userId, purpose },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.action === 'GRANTED';
  }

  private async currentNotices(tenantId: string) {
    const notices = await this.prisma.noticeVersion.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }], retiredAt: null },
      orderBy: [{ publishedAt: 'desc' }],
    });
    const byPurpose = new Map<ConsentPurpose, (typeof notices)[number]>();
    for (const n of notices) {
      const existing = byPurpose.get(n.purpose);
      if (!existing || (existing.tenantId === null && n.tenantId !== null)) byPurpose.set(n.purpose, n);
    }
    return [...byPurpose.values()].sort((a, b) => Number(b.required) - Number(a.required));
  }
}
