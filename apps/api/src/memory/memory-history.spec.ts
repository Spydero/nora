import type { ResultContent } from '../assessment/result.types.js';
import type { CaseStore } from '../checks/case-store.js';
import { ChecksService } from '../checks/checks.service.js';
import { demoBundle } from '../clinical/content/demo-bundle.js';
import type { FactMap } from '../clinical/rules-engine.js';
import type { ConsentService } from '../consent/consent.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MemoryService } from './memory.service.js';
import type { MemoryItem } from './memory.types.js';

const content = (label: string) => ({ status: 'COMPLETED', concerns: [{ label }], urgency: { level: 'soon', title: 'See a doctor within 24–48 hours' } }) as unknown as ResultContent;
const check = (id: string, daysAgo: number, concernCode: string) => ({
  id,
  title: id,
  concernCode,
  createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  currentResultId: `r-${id}`,
});

function memoryService(recent: ReturnType<typeof check>[], parent: ReturnType<typeof check> | null) {
  const prisma = {
    patientProfile: { findUnique: async () => null },
    assessmentSession: { findMany: async () => recent, findFirst: async () => parent },
    assessmentResult: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, content: content(id) })) },
    reviewTask: { findMany: async () => [] },
    patientReportedAppointment: { findMany: async () => [] },
  } as unknown as PrismaService;
  return new MemoryService(prisma);
}

const pastChecks = (items: MemoryItem[]) => items.filter((m) => m.kind === 'past_check').map((m) => m.checkId);

describe('the records Nora reads for a check', () => {
  const now = new Date();

  it('always includes the check being followed up, even when it is older than the recent ones', async () => {
    const recent = [check('c3', 1, 'cough'), check('c2', 2, 'headache')];
    const items = await memoryService(recent, check('c1', 120, 'sore_throat')).forPatient('t1', 'u1', { includeCheckId: 'c1', now });
    expect(pastChecks(items)).toEqual(['c3', 'c2', 'c1']);
  });

  it('lists the followed-up check once when it is also a recent one', async () => {
    const recent = [check('c3', 1, 'cough'), check('c1', 5, 'sore_throat')];
    const items = await memoryService(recent, check('c1', 5, 'sore_throat')).forPatient('t1', 'u1', { includeCheckId: 'c1', now });
    expect(pastChecks(items)).toEqual(['c3', 'c1']);
  });
});

describe('the earlier check Nora asks about', () => {
  const sessions = [check('c-throat', 3, 'sore_throat'), check('c-head', 2, 'headache')];
  const memory: MemoryItem[] = sessions.map((s, i) => ({
    id: `M${i + 1}`,
    kind: 'past_check',
    label: 'Earlier check',
    text: s.id,
    recordedAt: s.createdAt.toISOString(),
    href: '/history',
    checkId: s.id,
    concernCode: s.concernCode,
  }));
  const svc = () => {
    const prisma = {
      assessmentSession: { findFirst: async ({ where }: { where: { id: string } }) => sessions.find((s) => s.id === where.id) ?? null },
      assessmentResult: { findUnique: async () => ({ content: content('x') }) },
    } as unknown as PrismaService;
    const memoryService = { forPatient: async () => memory } as unknown as MemoryService;
    return new ChecksService(prisma, {} as CaseStore, {} as ConsentService, memoryService);
  };
  const earlier = (facts: FactMap, parentSessionId: string | null = null) =>
    (svc() as unknown as { earlierCheck: (s: unknown, b: unknown, f: FactMap) => Promise<{ id: string } | null> }).earlierCheck(
      { id: 'now', tenantId: 't1', patientUserId: 'u1', parentSessionId },
      demoBundle,
      facts,
    );

  it('is the recent check for the problem described in this check, as the assessment chooses it', async () => {
    expect((await earlier({ sore_throat: { state: 'PRESENT' } }))?.id).toBe('c-throat');
    expect((await earlier({ headache: { state: 'PRESENT' } }))?.id).toBe('c-head');
    expect(await earlier({ cough: { state: 'PRESENT' } })).toBeNull();
  });

  it('is none for a follow-up, which already names its earlier check', async () => {
    expect(await earlier({ sore_throat: { state: 'PRESENT' } }, 'c-head')).toBeNull();
  });
});
