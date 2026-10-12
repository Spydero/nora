import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReviewService } from '../review/review.service.js';
import { CAPABILITIES, type Capability, isCapability } from '../tenancy/capabilities.js';

export const toggleSchema = z.object({ enabled: z.boolean(), reason: z.string().trim().max(300).optional() });
export const memberUpdateSchema = z.object({ status: z.enum(['ACTIVE', 'REVOKED']) });
export const providerStatusSchema = z.object({ status: z.enum(['PUBLISHED', 'VERIFIED', 'SUSPENDED']) });
export const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const PLATFORM_FLAGS = ['assessment', 'ai_generation', 'provider_handoff'] as const;
const PLATFORM_FLAG_LABEL: Record<string, string> = {
  assessment: 'Symptom assessment',
  ai_generation: 'AI-generated explanations',
  provider_handoff: 'External booking handoff',
};

/** Names what an administrative event touched. Built only from non-clinical metadata. */
function auditDetail(
  e: { action: string; resourceId: string | null; metadata: unknown },
  providers: { id: string; name: string }[],
): string | null {
  const meta = (e.metadata ?? {}) as { capability?: string; status?: string; reason?: string | null };
  const why = meta.reason ? ` — “${meta.reason}”` : '';
  if (e.action.startsWith('capability.') && meta.capability) {
    return `${isCapability(meta.capability) ? CAPABILITIES[meta.capability].label : meta.capability}${why}`;
  }
  if (e.action.startsWith('platform_flag.') && e.resourceId) return `${PLATFORM_FLAG_LABEL[e.resourceId] ?? e.resourceId}${why}`;
  if (e.action === 'provider.status') {
    const who = providers.find((p) => p.id === e.resourceId)?.name ?? 'Doctor';
    return `${who} — ${meta.status === 'SUSPENDED' ? 'hidden from search' : 'listed'}`;
  }
  return null;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly review: ReviewService,
  ) {}

  async overview(principal: AuthPrincipal) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [tenant, flags, patients, checks, completed, escalated, reviews, referrals] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: principal.tenantId } }),
      this.prisma.platformFlag.findMany(),
      this.prisma.membership.count({ where: { tenantId: principal.tenantId, status: 'ACTIVE', roles: { has: 'PATIENT' } } }),
      this.prisma.assessmentSession.count({ where: { tenantId: principal.tenantId, createdAt: { gte: since } } }),
      this.prisma.assessmentSession.count({ where: { tenantId: principal.tenantId, createdAt: { gte: since }, status: 'COMPLETED' } }),
      this.prisma.assessmentSession.count({ where: { tenantId: principal.tenantId, createdAt: { gte: since }, status: 'ESCALATED' } }),
      this.review.openCounts(principal.tenantId),
      this.prisma.referral.count({ where: { tenantId: principal.tenantId, createdAt: { gte: since } } }),
    ]);
    const settings = (tenant.settings ?? {}) as { emergencyNumber?: string; crisisLine?: { name: string; number: string }; reviewSlaHours?: number };
    const flagOn = (key: string | null) => (key ? (flags.find((f) => f.key === key)?.enabled ?? true) : true);
    return {
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        region: tenant.region,
        status: tenant.status,
        emergencyNumber: settings.emergencyNumber ?? '112',
        crisisLine: settings.crisisLine ?? null,
        reviewSlaHours: settings.reviewSlaHours ?? 24,
      },
      capabilities: (Object.keys(CAPABILITIES) as Capability[]).map((key) => {
        const def = CAPABILITIES[key];
        return {
          key,
          label: def.label,
          phase: def.phase,
          available: def.phase === 'P0',
          enabled: tenant.capabilities.includes(key),
          platformEnabled: flagOn(def.platformFlag),
        };
      }),
      stats: { patients, checks7d: checks, completed7d: completed, escalated7d: escalated, openReviews: reviews.open, overdueReviews: reviews.overdue, referrals7d: referrals },
    };
  }

  async setCapability(principal: AuthPrincipal, key: string, input: z.infer<typeof toggleSchema>) {
    if (!isCapability(key)) throw new AppException(HttpStatus.NOT_FOUND, 'UNKNOWN_CAPABILITY', 'That capability does not exist.');
    if (CAPABILITIES[key].phase !== 'P0') {
      throw new AppException(HttpStatus.CONFLICT, 'CAPABILITY_UNAVAILABLE', 'This capability is not available yet.');
    }
    await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: principal.tenantId } });
      const next = input.enabled ? [...new Set([...tenant.capabilities, key])] : tenant.capabilities.filter((c) => c !== key);
      await tx.tenant.update({ where: { id: tenant.id }, data: { capabilities: next } });
      await this.audit.record(
        principal,
        { action: input.enabled ? 'capability.enable' : 'capability.disable', resourceType: 'tenant', resourceId: tenant.id, metadata: { capability: key, reason: input.reason ?? null } },
        tx,
      );
    });
    return this.overview(principal);
  }

  async members(principal: AuthPrincipal) {
    const rows = await this.prisma.membership.findMany({
      where: { tenantId: principal.tenantId },
      include: { user: { select: { email: true, displayName: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const lastSeen = await this.prisma.session.groupBy({
      by: ['membershipId'],
      where: { membershipId: { in: rows.map((r) => r.id) } },
      _max: { createdAt: true },
    });
    return rows.map((m) => ({
      id: m.id,
      email: m.user.email,
      displayName: m.user.displayName,
      roles: m.roles,
      status: m.status,
      isMe: m.id === principal.membershipId,
      lastSignInAt: lastSeen.find((s) => s.membershipId === m.id)?._max.createdAt?.toISOString() ?? null,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  /** Revoking a membership ends its sessions on the next request because the guard re-checks status. */
  async updateMember(principal: AuthPrincipal, id: string, input: z.infer<typeof memberUpdateSchema>) {
    if (id === principal.membershipId) throw new AppException(HttpStatus.CONFLICT, 'CANNOT_CHANGE_SELF', 'You cannot change your own access.');
    const member = await this.prisma.membership.findFirst({ where: { id, tenantId: principal.tenantId } });
    if (!member) throw new AppException(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'This member could not be found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id }, data: { status: input.status } });
      if (input.status === 'REVOKED') {
        await tx.session.updateMany({ where: { membershipId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'membership_revoked' } });
      }
      await this.audit.record(principal, { action: input.status === 'REVOKED' ? 'member.revoke' : 'member.restore', resourceType: 'membership', resourceId: id, subjectUserId: member.userId }, tx);
    });
    return this.members(principal);
  }

  async auditLog(principal: AuthPrincipal, limit: number) {
    const events = await this.prisma.auditEvent.findMany({ where: { tenantId: principal.tenantId }, orderBy: { createdAt: 'desc' }, take: limit });
    const ids = [...new Set(events.flatMap((e) => [e.actorUserId, e.subjectUserId]).filter((x): x is string => !!x))];
    const providerIds = events.filter((e) => e.resourceType === 'provider' && e.resourceId).map((e) => e.resourceId!);
    const [users, providers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
      this.prisma.provider.findMany({ where: { tenantId: principal.tenantId, id: { in: providerIds } }, select: { id: true, name: true } }),
    ]);
    const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.displayName ?? 'Unknown') : null);
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      resourceType: e.resourceType,
      purpose: e.purpose,
      outcome: e.outcome,
      actor: name(e.actorUserId),
      subject: name(e.subjectUserId),
      detail: auditDetail(e, providers),
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async providers(principal: AuthPrincipal) {
    const rows = await this.prisma.provider.findMany({ where: { tenantId: principal.tenantId }, include: { clinic: true }, orderBy: { name: 'asc' } });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      specialties: p.specialties,
      clinic: p.clinic.name,
      city: p.clinic.city,
      status: p.status,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      credentialExpiresAt: p.credentialExpiresAt?.toISOString() ?? null,
    }));
  }

  async setProviderStatus(principal: AuthPrincipal, id: string, input: z.infer<typeof providerStatusSchema>) {
    const provider = await this.prisma.provider.findFirst({ where: { id, tenantId: principal.tenantId } });
    if (!provider) throw new AppException(HttpStatus.NOT_FOUND, 'PROVIDER_NOT_FOUND', 'This provider could not be found.');
    const verifying = input.status !== 'SUSPENDED' && !provider.verifiedAt;
    await this.prisma.provider.update({
      where: { id },
      data: { status: input.status, ...(verifying ? { verifiedAt: new Date(), verifiedById: principal.userId } : {}) },
    });
    await this.audit.record(principal, { action: 'provider.status', resourceType: 'provider', resourceId: id, metadata: { status: input.status } });
    return this.providers(principal);
  }

  async platformFlags() {
    const flags = await this.prisma.platformFlag.findMany();
    return PLATFORM_FLAGS.map((key) => {
      const f = flags.find((x) => x.key === key);
      return { key, enabled: f?.enabled ?? true, reason: f?.reason ?? null, updatedAt: f?.updatedAt.toISOString() ?? null };
    });
  }

  async setPlatformFlag(principal: AuthPrincipal, key: string, input: z.infer<typeof toggleSchema>) {
    if (!(PLATFORM_FLAGS as readonly string[]).includes(key)) throw new AppException(HttpStatus.NOT_FOUND, 'UNKNOWN_FLAG', 'That platform flag does not exist.');
    if (!input.enabled && !input.reason) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields need attention.', false, { fields: [{ field: 'reason', message: 'Say why this is being turned off' }] });
    }
    await this.prisma.platformFlag.upsert({
      where: { key },
      create: { key, enabled: input.enabled, reason: input.reason ?? null, updatedById: principal.userId },
      update: { enabled: input.enabled, reason: input.reason ?? null, updatedById: principal.userId },
    });
    await this.audit.record(principal, { action: input.enabled ? 'platform_flag.enable' : 'platform_flag.disable', resourceType: 'platform_flag', resourceId: key, metadata: { reason: input.reason ?? null } });
    return this.platformFlags();
  }

  async content(principal: AuthPrincipal) {
    const [bundles, documents, medicines, tenant] = await Promise.all([
      this.prisma.clinicalBundle.findMany({ where: { OR: [{ tenantId: null }, { tenantId: principal.tenantId }] }, orderBy: { createdAt: 'desc' } }),
      this.prisma.knowledgeDocument.findMany({ where: { OR: [{ tenantId: null }, { tenantId: principal.tenantId }] }, include: { _count: { select: { chunks: true } } }, orderBy: { title: 'asc' } }),
      this.prisma.medicineEntry.findMany({ where: { OR: [{ tenantId: null }, { tenantId: principal.tenantId }] }, select: { slug: true, genericName: true, reviewedAt: true }, orderBy: { genericName: 'asc' } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: principal.tenantId }, select: { activeBundleId: true } }),
    ]);
    const now = Date.now();
    return {
      bundles: bundles.map((b) => {
        const content = b.content as { concerns?: unknown[]; urgencyRules?: unknown[]; questions?: Record<string, unknown> };
        const evaluation = b.evaluation as { passed?: boolean; sentinels?: { passed?: boolean }[] } | null;
        const sentinels = evaluation?.sentinels ?? [];
        return {
          id: b.id,
          version: b.version,
          status: b.status,
          active: b.id === tenant.activeBundleId,
          changeNote: b.changeNote,
          concerns: content.concerns?.length ?? 0,
          rules: content.urgencyRules?.length ?? 0,
          questions: Object.keys(content.questions ?? {}).length,
          evaluation: evaluation
            ? { passed: evaluation.passed ?? false, sentinelsPassed: sentinels.filter((s) => s.passed).length, sentinelsTotal: sentinels.length }
            : null,
          approvedAt: b.approvedAt?.toISOString() ?? null,
          releasedAt: b.releasedAt?.toISOString() ?? null,
        };
      }),
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        publisher: d.publisher,
        status: d.status,
        chunks: d._count.chunks,
        concernCodes: d.concernCodes,
        reviewDueAt: d.reviewDueAt.toISOString(),
        reviewOverdue: d.reviewDueAt.getTime() < now,
        url: d.url,
      })),
      medicines: medicines.map((m) => ({ slug: m.slug, genericName: m.genericName, reviewedAt: m.reviewedAt.toISOString() })),
    };
  }
}
