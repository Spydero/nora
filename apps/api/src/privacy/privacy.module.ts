import { Body, Controller, Get, HttpStatus, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { AppException } from '../common/app.exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const OPEN = ['RECEIVED', 'IN_PROGRESS'];
/** Deletion requests wait this long so a patient can change their mind. */
const DELETION_GRACE_DAYS = 30;

const deletionSchema = z.object({ confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }) });

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requests(principal: AuthPrincipal) {
    const rows = await this.prisma.privacyRequest.findMany({
      where: { tenantId: principal.tenantId, userId: principal.userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  /** Everything Nora holds about the patient in this organisation, as portable JSON. */
  async export(principal: AuthPrincipal) {
    const scope = { tenantId: principal.tenantId, userId: principal.userId };
    const [user, profile, consents, sessions, referrals, appointments, requests] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId }, select: { email: true, displayName: true, createdAt: true } }),
      this.prisma.patientProfile.findUnique({ where: { tenantId_userId: scope }, include: { versions: { orderBy: { version: 'asc' } } } }),
      this.prisma.consentRecord.findMany({ where: { tenantId: scope.tenantId, subjectUserId: scope.userId }, include: { notice: { select: { purpose: true, version: true, title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.assessmentSession.findMany({
        where: { tenantId: scope.tenantId, patientUserId: scope.userId },
        include: { messages: { orderBy: { createdAt: 'asc' } }, results: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.referral.findMany({ where: { tenantId: scope.tenantId, patientUserId: scope.userId } }),
      this.prisma.patientReportedAppointment.findMany({ where: { tenantId: scope.tenantId, patientUserId: scope.userId } }),
      this.prisma.privacyRequest.findMany({ where: scope }),
    ]);

    const request = await this.prisma.privacyRequest.create({
      data: { ...scope, type: 'EXPORT', status: 'COMPLETED', completedAt: new Date(), detail: { checks: sessions.length } },
    });
    await this.audit.record(principal, { action: 'privacy.export', resourceType: 'privacy_request', resourceId: request.id, subjectUserId: principal.userId, metadata: { checks: sessions.length } });

    return {
      exportedAt: new Date().toISOString(),
      format: 'nora-export/1',
      account: user,
      profile: profile && {
        current: { ...profile, versions: undefined },
        history: profile.versions.map((v) => ({ version: v.version, data: v.data, source: v.source, createdAt: v.createdAt })),
      },
      consents: consents.map((c) => ({ purpose: c.purpose, action: c.action, notice: c.notice, at: c.createdAt })),
      checks: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        urgency: s.urgency,
        createdAt: s.createdAt,
        messages: s.messages.map((m) => ({ sender: m.sender, kind: m.kind, text: m.text, at: m.createdAt })),
        results: s.results.map((r) => ({ createdAt: r.createdAt, supersededAt: r.supersededAt, content: r.content })),
      })),
      referrals,
      appointments,
      privacyRequests: requests,
    };
  }

  async requestDeletion(principal: AuthPrincipal) {
    const open = await this.prisma.privacyRequest.findFirst({
      where: { tenantId: principal.tenantId, userId: principal.userId, type: 'DELETION', status: { in: OPEN } },
    });
    if (open) throw new AppException(HttpStatus.CONFLICT, 'DELETION_ALREADY_REQUESTED', 'You already have a deletion request in progress.');
    const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);
    const request = await this.prisma.privacyRequest.create({
      data: { tenantId: principal.tenantId, userId: principal.userId, type: 'DELETION', detail: { scheduledFor: scheduledFor.toISOString() } },
    });
    await this.audit.record(principal, { action: 'privacy.deletion.request', resourceType: 'privacy_request', resourceId: request.id, subjectUserId: principal.userId });
    return this.requests(principal);
  }

  async cancel(principal: AuthPrincipal, id: string) {
    const updated = await this.prisma.privacyRequest.updateMany({
      where: { id, tenantId: principal.tenantId, userId: principal.userId, status: 'RECEIVED' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (updated.count !== 1) throw new AppException(HttpStatus.CONFLICT, 'REQUEST_NOT_CANCELLABLE', 'This request can no longer be cancelled.');
    await this.audit.record(principal, { action: 'privacy.request.cancel', resourceType: 'privacy_request', resourceId: id, subjectUserId: principal.userId });
    return this.requests(principal);
  }
}

@Controller('privacy')
@Roles('PATIENT')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('requests')
  requests(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.privacy.requests(principal);
  }

  @Post('export')
  export(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.privacy.export(principal);
  }

  @Post('deletion')
  requestDeletion(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(deletionSchema)) _body: z.infer<typeof deletionSchema>) {
    return this.privacy.requestDeletion(principal);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.cancel(principal, id);
  }
}

@Module({ controllers: [PrivacyController], providers: [PrivacyService] })
export class PrivacyModule {}
