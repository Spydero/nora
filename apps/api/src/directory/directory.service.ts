import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Capability } from '../tenancy/capabilities.js';

/** Providers shown to patients: verified, with credentials still valid. */
const LISTED = ['VERIFIED', 'PUBLISHED'];

export const providerQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  specialty: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  mode: z.enum(['in_person', 'video']).optional(),
  language: z.string().trim().max(30).optional(),
});

export const referralSchema = z.object({ providerId: z.uuid(), checkId: z.uuid().optional() });

export const appointmentSchema = z.object({
  providerId: z.uuid(),
  referralId: z.uuid().optional(),
  scheduledAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().max(60).default('Asia/Kolkata'),
  notes: z.string().trim().max(500).optional(),
});

export const appointmentUpdateSchema = z.object({
  status: z.enum(['PATIENT_REPORTED', 'ATTENDED', 'CANCELLED', 'MISSED']).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().trim().max(500).optional(),
});

type ProviderRow = Prisma.ProviderGetPayload<{ include: { clinic: true } }>;

function providerView(p: ProviderRow, bookingAvailable = true) {
  return {
    id: p.id,
    name: p.name,
    specialties: p.specialties,
    languages: p.languages,
    qualifications: p.qualifications,
    registrationNumber: p.registrationNumber,
    acceptingNewPatients: p.status === 'PUBLISHED',
    consultationModes: p.consultationModes,
    fee: { amount: p.feeAmount, currency: p.currency },
    nextAvailableAt: p.nextAvailableAt?.toISOString() ?? null,
    scheduleUpdatedAt: p.scheduleUpdatedAt?.toISOString() ?? null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    booking: { method: p.bookingMethod, url: p.bookingUrl, phone: p.bookingPhone, available: bookingAvailable },
    bio: p.bio,
    clinic: { name: p.clinic.name, address: p.clinic.address, city: p.clinic.city, phone: p.clinic.phone, accessibility: p.accessibility },
  };
}

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requireCapability(tenantId: string, capability: Capability) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { capabilities: true } });
    if (!tenant.capabilities.includes(capability)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CAPABILITY_DISABLED', 'Your organisation has not turned on this feature.');
    }
  }

  /** Booking handoff needs the tenant capability and the platform-wide switch. */
  async handoffAvailable(tenantId: string): Promise<boolean> {
    const [tenant, flag] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { capabilities: true } }),
      this.prisma.platformFlag.findUnique({ where: { key: 'provider_handoff' } }),
    ]);
    return tenant.capabilities.includes('external_handoff') && (flag?.enabled ?? true);
  }

  // ── Medicines (education only) ──

  async medicines(principal: AuthPrincipal, q?: string) {
    await this.requireCapability(principal.tenantId, 'medicines_education');
    const rows = await this.prisma.medicineEntry.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: principal.tenantId }] },
      orderBy: { genericName: 'asc' },
    });
    // A tenant entry replaces the global entry with the same slug.
    const bySlug = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!bySlug.has(r.slug) || r.tenantId) bySlug.set(r.slug, r);
    const term = q?.trim().toLowerCase();
    const matches = (m: (typeof rows)[number]) =>
      !term || [m.genericName, m.category, m.purpose, ...m.brandExamples].some((field) => field.toLowerCase().includes(term));
    return [...bySlug.values()]
      .filter(matches)
      .map((m) => ({ slug: m.slug, genericName: m.genericName, brandExamples: m.brandExamples, category: m.category, purpose: m.purpose, otc: m.otc }));
  }

  async medicine(principal: AuthPrincipal, slug: string) {
    await this.requireCapability(principal.tenantId, 'medicines_education');
    const rows = await this.prisma.medicineEntry.findMany({ where: { slug, OR: [{ tenantId: null }, { tenantId: principal.tenantId }] } });
    const m = rows.find((r) => r.tenantId === principal.tenantId) ?? rows[0];
    if (!m) throw new AppException(HttpStatus.NOT_FOUND, 'MEDICINE_NOT_FOUND', 'We could not find that medicine.');
    return {
      slug: m.slug,
      genericName: m.genericName,
      brandExamples: m.brandExamples,
      category: m.category,
      purpose: m.purpose,
      commonSideEffects: m.commonSideEffects,
      warnings: m.warnings,
      askClinicianIf: m.askClinicianIf,
      otc: m.otc,
      reviewedAt: m.reviewedAt.toISOString(),
    };
  }

  // ── Providers ──

  private listedWhere(tenantId: string): Prisma.ProviderWhereInput {
    return {
      tenantId,
      status: { in: LISTED },
      verifiedAt: { not: null },
      OR: [{ credentialExpiresAt: null }, { credentialExpiresAt: { gt: new Date() } }],
    };
  }

  async providers(principal: AuthPrincipal, query: z.infer<typeof providerQuerySchema>) {
    await this.requireCapability(principal.tenantId, 'provider_directory');
    const where: Prisma.ProviderWhereInput = {
      ...this.listedWhere(principal.tenantId),
      ...(query.specialty ? { specialties: { has: query.specialty } } : {}),
      ...(query.mode ? { consultationModes: { has: query.mode } } : {}),
      ...(query.language ? { languages: { has: query.language } } : {}),
      ...(query.city ? { clinic: { city: query.city } } : {}),
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { clinic: { name: { contains: query.q, mode: 'insensitive' } } },
                  { bio: { contains: query.q, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, bookable] = await Promise.all([this.prisma.provider.findMany({ where, include: { clinic: true } }), this.handoffAvailable(principal.tenantId)]);
    const soonest = (p: ProviderRow) => p.nextAvailableAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return rows
      .sort((a, b) => Number(b.status === 'PUBLISHED') - Number(a.status === 'PUBLISHED') || soonest(a) - soonest(b) || a.name.localeCompare(b.name))
      .map((p) => providerView(p, bookable));
  }

  async providerFacets(principal: AuthPrincipal) {
    await this.requireCapability(principal.tenantId, 'provider_directory');
    const rows = await this.prisma.provider.findMany({ where: this.listedWhere(principal.tenantId), include: { clinic: true } });
    const uniq = (values: string[]) => [...new Set(values)].sort();
    return {
      specialties: uniq(rows.flatMap((r) => r.specialties)),
      cities: uniq(rows.map((r) => r.clinic.city)),
      languages: uniq(rows.flatMap((r) => r.languages)),
    };
  }

  async provider(principal: AuthPrincipal, id: string) {
    await this.requireCapability(principal.tenantId, 'provider_directory');
    const row = await this.prisma.provider.findFirst({ where: { id, ...this.listedWhere(principal.tenantId) }, include: { clinic: true } });
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'PROVIDER_NOT_FOUND', 'This doctor is not listed.');
    return providerView(row, await this.handoffAvailable(principal.tenantId));
  }

  // ── Handoff ──

  /** Records that the patient left Nora to book; booking itself happens with the provider. */
  async createReferral(principal: AuthPrincipal, input: z.infer<typeof referralSchema>) {
    if (!(await this.handoffAvailable(principal.tenantId))) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'HANDOFF_UNAVAILABLE', 'Booking through Nora is paused right now. You can still contact the clinic directly.');
    }
    const provider = await this.provider(principal, input.providerId);
    let session: { id: string; currentResultId: string | null } | null = null;
    let specialty: string | null = null;
    if (input.checkId) {
      session = await this.prisma.assessmentSession.findFirst({
        where: { id: input.checkId, tenantId: principal.tenantId, patientUserId: principal.userId },
        select: { id: true, currentResultId: true },
      });
      if (!session) throw new AppException(HttpStatus.NOT_FOUND, 'CHECK_NOT_FOUND', 'This check could not be found.');
      if (session.currentResultId) {
        const result = await this.prisma.assessmentResult.findUnique({ where: { id: session.currentResultId }, select: { content: true } });
        specialty = (result?.content as { handoff?: { specialty?: string | null } } | null)?.handoff?.specialty ?? null;
      }
    }
    const referral = await this.prisma.referral.create({
      data: {
        tenantId: principal.tenantId,
        patientUserId: principal.userId,
        providerId: provider.id,
        sessionId: session?.id ?? null,
        resultId: session?.currentResultId ?? null,
        specialty: specialty ?? provider.specialties[0] ?? null,
      },
    });
    await this.audit.record(principal, { action: 'handoff.open', resourceType: 'referral', resourceId: referral.id, subjectUserId: principal.userId, metadata: { providerId: provider.id } });
    return { id: referral.id, status: referral.status, createdAt: referral.createdAt.toISOString(), provider };
  }

  // ── Appointments ──

  async appointments(principal: AuthPrincipal) {
    const scope = { tenantId: principal.tenantId, patientUserId: principal.userId };
    const [referrals, appointments] = await Promise.all([
      this.prisma.referral.findMany({ where: scope, orderBy: { createdAt: 'desc' } }),
      this.prisma.patientReportedAppointment.findMany({ where: scope, orderBy: { scheduledAt: 'asc' } }),
    ]);
    const providerIds = [...new Set([...referrals.map((r) => r.providerId), ...appointments.map((a) => a.providerId)])];
    const providers = await this.prisma.provider.findMany({ where: { id: { in: providerIds }, tenantId: principal.tenantId }, include: { clinic: true } });
    const byId = new Map(providers.map((p) => [p.id, providerView(p)]));
    const sessions = await this.prisma.assessmentSession.findMany({
      where: { id: { in: referrals.map((r) => r.sessionId).filter((s): s is string => !!s) } },
      select: { id: true, title: true },
    });
    return {
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        specialty: r.specialty,
        createdAt: r.createdAt.toISOString(),
        check: sessions.find((s) => s.id === r.sessionId) ?? null,
        provider: byId.get(r.providerId) ?? null,
      })),
      appointments: appointments.map((a) => this.appointmentView(a, byId.get(a.providerId) ?? null)),
    };
  }

  async createAppointment(principal: AuthPrincipal, input: z.infer<typeof appointmentSchema>) {
    const provider = await this.provider(principal, input.providerId);
    if (input.referralId) {
      const owned = await this.prisma.referral.findFirst({ where: { id: input.referralId, tenantId: principal.tenantId, patientUserId: principal.userId } });
      if (!owned) throw new AppException(HttpStatus.NOT_FOUND, 'REFERRAL_NOT_FOUND', 'This booking could not be found.');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patientReportedAppointment.create({
        data: {
          tenantId: principal.tenantId,
          patientUserId: principal.userId,
          providerId: provider.id,
          referralId: input.referralId ?? null,
          scheduledAt: new Date(input.scheduledAt),
          timeZone: input.timeZone,
          notes: input.notes || null,
        },
      });
      if (input.referralId) await tx.referral.update({ where: { id: input.referralId }, data: { status: 'APPOINTMENT_REPORTED' } });
      await this.audit.record(principal, { action: 'appointment.create', resourceType: 'appointment', resourceId: created.id, subjectUserId: principal.userId }, tx);
      return created;
    });
    return this.appointmentView(row, provider);
  }

  async updateAppointment(principal: AuthPrincipal, id: string, input: z.infer<typeof appointmentUpdateSchema>) {
    const existing = await this.prisma.patientReportedAppointment.findFirst({ where: { id, tenantId: principal.tenantId, patientUserId: principal.userId } });
    if (!existing) throw new AppException(HttpStatus.NOT_FOUND, 'APPOINTMENT_NOT_FOUND', 'This appointment could not be found.');
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : existing.scheduledAt;
    if ((input.status === 'ATTENDED' || input.status === 'MISSED') && scheduledAt.getTime() > Date.now()) {
      throw new AppException(HttpStatus.CONFLICT, 'APPOINTMENT_IN_FUTURE', 'You can mark this after the appointment time.');
    }
    const row = await this.prisma.patientReportedAppointment.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      },
    });
    await this.audit.record(principal, { action: 'appointment.update', resourceType: 'appointment', resourceId: id, subjectUserId: principal.userId, metadata: { status: row.status } });
    const provider = await this.prisma.provider.findFirst({ where: { id: row.providerId }, include: { clinic: true } });
    return this.appointmentView(row, provider ? providerView(provider) : null);
  }

  private appointmentView(a: Prisma.PatientReportedAppointmentGetPayload<object>, provider: ReturnType<typeof providerView> | null) {
    return {
      id: a.id,
      referralId: a.referralId,
      scheduledAt: a.scheduledAt.toISOString(),
      timeZone: a.timeZone,
      notes: a.notes,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      provider,
    };
  }
}
