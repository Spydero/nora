import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { Role } from '../src/generated/prisma/enums.js';
import { DEMO_BUNDLE_VERSION, demoBundle } from '../src/clinical/content/demo-bundle.js';
import { demoKnowledge } from '../src/clinical/content/knowledge.js';
import { demoMedicines } from '../src/clinical/content/medicines.js';
import { demoClinics, demoProviders } from '../src/clinical/content/providers.js';
import { runSentinels } from '../src/clinical/rules-engine.js';
import { DEFAULT_CAPABILITIES } from '../src/tenancy/capabilities.js';

const DEMO_PASSWORD = 'NoraDemo!2026';

const IST_OFFSET_MS = 330 * 60_000;
const HALF_HOUR_MS = 30 * 60_000;

/** First half-hour slot at least `hours` from now that falls within clinic hours (09:30–18:30 IST). */
function clinicSlot(from: number, hours: number): Date {
  let local = Math.ceil((from + hours * 3_600_000 + IST_OFFSET_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
  const minuteOfDay = (local % 86_400_000) / 60_000;
  const dayStart = local - minuteOfDay * 60_000;
  if (minuteOfDay < 9.5 * 60) local = dayStart + 9.5 * 3_600_000;
  else if (minuteOfDay > 18.5 * 60) local = dayStart + 86_400_000 + 9.5 * 3_600_000;
  return new Date(local - IST_OFFSET_MS);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

interface DemoUser {
  email: string;
  displayName: string;
  roles: Role[];
}

const demoTenantUsers: DemoUser[] = [
  { email: 'patient@demo.nora.local', displayName: 'Aarav Patel', roles: [Role.PATIENT] },
  { email: 'priya@demo.nora.local', displayName: 'Priya Nair', roles: [Role.PATIENT] },
  { email: 'clinician@demo.nora.local', displayName: 'Dr Kiran Rao', roles: [Role.CLINICIAN] },
  { email: 'coordinator@demo.nora.local', displayName: 'Sana Coordinator', roles: [Role.CARE_COORDINATOR] },
  { email: 'admin@demo.nora.local', displayName: 'Demo Tenant Admin', roles: [Role.TENANT_ADMIN] },
  { email: 'editor@demo.nora.local', displayName: 'Content Editor', roles: [Role.CLINICAL_CONTENT_EDITOR] },
  { email: 'approver@demo.nora.local', displayName: 'Dr Clinical Approver', roles: [Role.CLINICAL_APPROVER, Role.CLINICIAN] },
  { email: 'operator@nora.local', displayName: 'Platform Operator', roles: [Role.PLATFORM_OPERATOR] },
];

const acmeUsers: DemoUser[] = [
  { email: 'patient@acme.nora.local', displayName: 'Acme Patient', roles: [Role.PATIENT] },
  { email: 'clinician@acme.nora.local', displayName: 'Dr Acme Clinician', roles: [Role.CLINICIAN] },
  { email: 'admin@acme.nora.local', displayName: 'Acme Admin', roles: [Role.TENANT_ADMIN] },
];

const indiaSettings = {
  emergencyNumber: '112',
  crisisLine: { name: 'Tele-MANAS', number: '14416' },
  timeZone: 'Asia/Kolkata',
  currency: 'INR',
  locale: 'en-IN',
  languages: ['en'],
  theme: {},
  reviewSlaHours: 24,
  idleTimeoutMinutes: { patient: 30, staff: 15 },
};

async function upsertTenant(slug: string, name: string, settings: object) {
  return prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, region: 'in-local', status: 'ACTIVE', capabilities: [...DEFAULT_CAPABILITIES], settings },
  });
}

async function upsertUsers(tenantId: string, users: DemoUser[], passwordHash: string) {
  const ids: Record<string, string> = {};
  for (const demo of users) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: { email: demo.email, displayName: demo.displayName, passwordHash },
    });
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      update: { roles: demo.roles, status: 'ACTIVE' },
      create: { tenantId, userId: user.id, roles: demo.roles },
    });
    ids[demo.email] = user.id;
  }
  return ids;
}

async function seedNotices(tenantId: string) {
  const notices = [
    { purpose: 'PROCESSING' as const, required: true, title: 'How Nora uses your health information', body: 'Nora processes the symptoms and health details you share to provide health information and suggest next steps. Your information is stored securely, is visible to clinicians in your organisation only for review or care, and is never sold. Nora does not provide a diagnosis.' },
    { purpose: 'CLINICIAN_SHARING' as const, required: false, title: 'Sharing summaries with clinicians', body: 'Allow Nora to share an assessment summary with a clinician you choose when you request a handoff.' },
    { purpose: 'ANALYTICS' as const, required: false, title: 'Product improvement analytics', body: 'Allow Nora to record anonymous usage events (never your symptoms or messages) to improve the service.' },
    { purpose: 'VOICE' as const, required: false, title: 'Voice input', body: 'Allow Nora to process audio you record to transcribe your symptoms. Audio is deleted after transcription.' },
  ];
  const ids: Record<string, string> = {};
  for (const n of notices) {
    const row = await prisma.noticeVersion.upsert({
      where: { tenantId_purpose_version: { tenantId, purpose: n.purpose, version: '1.0' } },
      update: {},
      create: { tenantId, version: '1.0', ...n },
    });
    ids[n.purpose] = row.id;
  }
  return ids;
}

async function seedBundle(tenantId: string, authorId: string, approverId: string) {
  const sentinel = runSentinels(demoBundle);
  if (!sentinel.passed) throw new Error('Demo bundle failed sentinel evaluation; refusing to seed');
  const existing = await prisma.clinicalBundle.findUnique({ where: { tenantId_version: { tenantId, version: DEMO_BUNDLE_VERSION } } });
  const bundle =
    existing ??
    (await prisma.clinicalBundle.create({
      data: {
        tenantId,
        version: DEMO_BUNDLE_VERSION,
        status: 'RELEASED',
        content: demoBundle as object,
        changeNote: 'Concern-specific warning signs; adds fever, cold/flu, diarrhoea and vomiting, skin rash, ear pain and dizziness',
        authorId,
        approverId,
        approvedAt: new Date(),
        evaluation: { sentinels: sentinel.results, passed: true } as object,
        evaluatedAt: new Date(),
        releasedAt: new Date(),
      },
    }));
  await prisma.tenant.update({ where: { id: tenantId }, data: { activeBundleId: bundle.id } });
  return bundle;
}

async function seedKnowledge() {
  const now = new Date();
  const reviewDue = new Date(now.getTime() + 365 * 86_400_000);
  for (const doc of demoKnowledge) {
    const latest = await prisma.knowledgeDocument.findFirst({
      where: { tenantId: null, sourceKey: doc.sourceKey },
      orderBy: { version: 'desc' },
      include: { chunks: { orderBy: { ordinal: 'asc' } } },
    });
    const unchanged =
      latest &&
      latest.title === doc.title &&
      latest.publisher === doc.publisher &&
      latest.url === doc.url &&
      latest.licence === doc.licence &&
      JSON.stringify(latest.chunks.map((c) => [c.heading, c.text])) === JSON.stringify(doc.chunks.map((c) => [c.heading, c.text]));
    if (unchanged) {
      await prisma.knowledgeDocument.update({ where: { id: latest.id }, data: { concernCodes: doc.concernCodes } });
      continue;
    }
    // Changed content becomes a new version; earlier versions stay so past results can still show what they cited.
    await prisma.knowledgeDocument.create({
      data: {
        sourceKey: doc.sourceKey,
        version: (latest?.version ?? 0) + 1,
        title: doc.title,
        publisher: doc.publisher,
        jurisdiction: 'IN',
        url: doc.url,
        licence: doc.licence,
        publishedAt: now,
        reviewedAt: now,
        reviewDueAt: reviewDue,
        concernCodes: doc.concernCodes,
        status: 'APPROVED',
        chunks: { create: doc.chunks.map((c, i) => ({ ordinal: i, heading: c.heading, text: c.text })) },
      },
    });
  }
}

async function seedMedicines() {
  for (const m of demoMedicines) {
    const exists = await prisma.medicineEntry.findFirst({ where: { tenantId: null, slug: m.slug } });
    if (exists) continue;
    await prisma.medicineEntry.create({
      data: {
        slug: m.slug,
        genericName: m.genericName,
        brandExamples: m.brandNames,
        category: m.drugClass,
        purpose: m.uses,
        commonSideEffects: m.commonSideEffects,
        warnings: m.seriousWarnings,
        askClinicianIf: m.askClinicianIf,
        otc: m.otc,
        reviewedAt: new Date(),
      },
    });
  }
}

async function seedProviders(tenantId: string, verifierId: string) {
  const clinicIds: Record<string, string> = {};
  for (const c of demoClinics) {
    const existing = await prisma.clinic.findFirst({ where: { tenantId, name: c.name } });
    const clinic =
      existing ??
      (await prisma.clinic.create({
        data: { tenantId, name: c.name, address: `${c.address}, ${c.city}${c.postcode ? ` ${c.postcode}` : ''}`, city: c.city, latitude: c.lat || null, longitude: c.lng || null, phone: c.phone },
      }));
    clinicIds[c.externalRef] = clinic.id;
  }
  const now = Date.now();
  for (const [i, p] of demoProviders.entries()) {
    const clinic = demoClinics.find((c) => c.externalRef === p.clinicRef)!;
    const data = {
      clinicId: clinicIds[p.clinicRef]!,
      name: p.name,
      title: p.name.startsWith('Dr.') ? 'Dr.' : '',
      specialties: [p.specialty],
      languages: p.languages,
      qualifications: p.qualifications.split(', '),
      registrationNumber: `DEMO-NMC-${String(10_000 + i)}`,
      status: p.acceptingNew ? 'PUBLISHED' : 'VERIFIED',
      verifiedAt: new Date(),
      verifiedById: verifierId,
      credentialExpiresAt: new Date(now + 2 * 365 * 86_400_000),
      bookingMethod: p.bookingMethod,
      bookingUrl: p.bookingMethod === 'url' ? `https://example.org/book/${p.externalRef}` : null,
      bookingPhone: clinic.phone,
      consultationModes: p.modes,
      feeAmount: p.feeMinor,
      currency: 'INR',
      accessibility: clinic.accessibility,
      nextAvailableAt: p.nextAvailableInHours === null ? null : clinicSlot(now, p.nextAvailableInHours),
      scheduleUpdatedAt: p.nextAvailableInHours === null ? null : new Date(),
      bio: `${p.specialty} at ${clinic.name}. Synthetic demo profile.`,
    };
    await prisma.provider.upsert({
      where: { tenantId_externalRef: { tenantId, externalRef: p.externalRef } },
      update: data,
      create: { tenantId, externalRef: p.externalRef, ...data },
    });
  }
}

async function seedPatient(tenantId: string, userId: string, noticeIds: Record<string, string>, profile: object, granted: string[]) {
  const existing = await prisma.patientProfile.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!existing) {
    const created = await prisma.patientProfile.create({ data: { tenantId, userId, ...profile } });
    await prisma.profileVersion.create({ data: { profileId: created.id, version: 1, data: profile, actorUserId: userId, source: 'seed' } });
  }
  const hasConsent = await prisma.consentRecord.findFirst({ where: { tenantId, subjectUserId: userId } });
  if (!hasConsent) {
    for (const purpose of granted) {
      await prisma.consentRecord.create({
        data: { tenantId, subjectUserId: userId, actorUserId: userId, purpose: purpose as 'PROCESSING', action: 'GRANTED', noticeVersionId: noticeIds[purpose]! },
      });
    }
  }
}

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const demo = await upsertTenant('demo', 'Nora Demo Health', indiaSettings);
  const demoIds = await upsertUsers(demo.id, demoTenantUsers, passwordHash);
  const demoNotices = await seedNotices(demo.id);
  await seedBundle(demo.id, demoIds['editor@demo.nora.local']!, demoIds['approver@demo.nora.local']!);
  await seedProviders(demo.id, demoIds['admin@demo.nora.local']!);

  const acme = await upsertTenant('acme', 'Acme Clinics (isolation test tenant)', { ...indiaSettings, theme: { accent: '#5B4BC4' } });
  const acmeIds = await upsertUsers(acme.id, acmeUsers, passwordHash);
  const acmeNotices = await seedNotices(acme.id);
  await seedBundle(acme.id, acmeIds['admin@acme.nora.local']!, acmeIds['clinician@acme.nora.local']!);

  await seedKnowledge();
  await seedMedicines();

  await seedPatient(
    demo.id,
    demoIds['patient@demo.nora.local']!,
    demoNotices,
    {
      dateOfBirth: new Date('1990-04-12'),
      sexAtBirth: 'MALE',
      pregnancyStatus: 'NOT_APPLICABLE',
      conditions: { state: 'known', items: ['Hypothyroidism'] },
      medications: { state: 'known', items: ['Levothyroxine'] },
      allergies: { state: 'known', items: ['Penicillin'] },
      city: 'Bengaluru',
    },
    ['PROCESSING', 'CLINICIAN_SHARING'],
  );
  await seedPatient(acme.id, acmeIds['patient@acme.nora.local']!, acmeNotices, { dateOfBirth: new Date('1985-01-01'), city: 'Mumbai' }, ['PROCESSING']);

  await prisma.platformFlag.createMany({
    data: [
      { key: 'assessment', enabled: true },
      { key: 'ai_generation', enabled: true },
      { key: 'provider_handoff', enabled: true },
    ],
    skipDuplicates: true,
  });

  console.log(`Seeded tenants "demo" and "acme" (password for every user: ${DEMO_PASSWORD})`);
  for (const u of [...demoTenantUsers, ...acmeUsers]) console.log(`  ${u.email.padEnd(32)} [${u.roles.join(', ')}]`);
  console.log(`  priya@demo.nora.local has no consent or profile yet (fresh onboarding).`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
