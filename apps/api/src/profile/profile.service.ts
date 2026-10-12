import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

const healthList = z
  .object({
    state: z.enum(['known', 'none', 'unknown', 'declined']),
    items: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .refine((l) => l.state !== 'known' || l.items.length > 0, { path: ['items'], message: 'Add at least one, or choose “None” or “Not sure”' });

export const profileSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    displayName: z.string().trim().min(1, 'Enter your name').max(120),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
      .nullable()
      .refine((v) => v === null || (new Date(v) <= new Date() && new Date(v) > new Date('1900-01-01')), 'Enter a real date of birth in the past'),
    sexAtBirth: z.enum(['FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN']),
    pregnancyStatus: z.enum(['PREGNANT', 'NOT_PREGNANT', 'NOT_APPLICABLE', 'UNKNOWN']),
    conditions: healthList,
    medications: healthList,
    allergies: healthList,
    city: z.string().trim().max(80).nullable(),
    preferredLanguage: z.enum(['en']),
  })
  .refine((p) => !(p.sexAtBirth === 'MALE' && p.pregnancyStatus === 'PREGNANT'), {
    path: ['pregnancyStatus'],
    message: 'Check your pregnancy status',
  });

export type ProfileInput = z.infer<typeof profileSchema>;
type HealthList = z.infer<typeof healthList>;

const EMPTY_LIST: HealthList = { state: 'unknown', items: [] };

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(principal: AuthPrincipal) {
    const [user, profile] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } }),
      this.prisma.patientProfile.findUnique({ where: { tenantId_userId: { tenantId: principal.tenantId, userId: principal.userId } } }),
    ]);
    return {
      version: profile?.version ?? 0,
      email: user.email,
      displayName: user.displayName,
      dateOfBirth: profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      sexAtBirth: profile?.sexAtBirth ?? 'UNKNOWN',
      pregnancyStatus: profile?.pregnancyStatus ?? 'UNKNOWN',
      conditions: (profile?.conditions as HealthList | undefined) ?? EMPTY_LIST,
      medications: (profile?.medications as HealthList | undefined) ?? EMPTY_LIST,
      allergies: (profile?.allergies as HealthList | undefined) ?? EMPTY_LIST,
      city: profile?.city ?? null,
      preferredLanguage: profile?.preferredLanguage ?? 'en',
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    };
  }

  /** Each save writes a new version so earlier checks keep the profile they were assessed with. */
  async update(principal: AuthPrincipal, input: ProfileInput) {
    const { expectedVersion, displayName, ...rest } = input;
    const listOf = (l: HealthList) => (l.state === 'known' ? { state: 'known', items: [...new Set(l.items)] } : { state: l.state, items: [] });
    const data = {
      dateOfBirth: rest.dateOfBirth ? new Date(rest.dateOfBirth) : null,
      sexAtBirth: rest.sexAtBirth,
      pregnancyStatus: rest.pregnancyStatus,
      conditions: listOf(rest.conditions),
      medications: listOf(rest.medications),
      allergies: listOf(rest.allergies),
      city: rest.city || null,
      preferredLanguage: rest.preferredLanguage,
    };

    await this.prisma.$transaction(async (tx) => {
      const where = { tenantId_userId: { tenantId: principal.tenantId, userId: principal.userId } };
      const current = await tx.patientProfile.findUnique({ where });
      if ((current?.version ?? 0) !== expectedVersion) {
        throw new AppException(HttpStatus.CONFLICT, 'STALE_PROFILE', 'Your profile was changed somewhere else. Reload to see the latest version.', true);
      }
      const saved = current
        ? await tx.patientProfile.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.patientProfile.create({ data: { tenantId: principal.tenantId, userId: principal.userId, ...data } });
      await tx.profileVersion.create({
        data: { profileId: saved.id, version: saved.version, data: { ...data, dateOfBirth: rest.dateOfBirth }, actorUserId: principal.userId, source: 'patient' },
      });
      await tx.user.update({ where: { id: principal.userId }, data: { displayName } });
      await this.audit.record(principal, { action: 'profile.update', resourceType: 'patient_profile', resourceId: saved.id, subjectUserId: principal.userId, metadata: { version: saved.version } }, tx);
    });
    return this.get(principal);
  }
}
