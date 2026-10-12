import type { AuthPrincipal } from '../auth/auth.types.js';
import type { ConsentService } from '../consent/consent.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CaseStore } from './case-store.js';
import { ChecksService } from './checks.service.js';

const principal = (userId: string) => ({ tenantId: 't1', userId, role: 'PATIENT' }) as unknown as AuthPrincipal;
const session = { id: 's1', tenantId: 't1', patientUserId: 'aarav', status: 'COLLECTING', inputVersion: 1, pendingQuestionId: 'q_fever', bundleId: 'b1' };

function service(opts: { consented?: boolean; enabled?: boolean } = {}) {
  const writes: string[] = [];
  const prisma = {
    assessmentSession: {
      findFirst: async ({ where }: { where: Record<string, string> }) =>
        Object.entries(where).every(([k, v]) => (session as Record<string, unknown>)[k] === v) ? session : null,
      findUnique: async () => null,
    },
    message: { findUnique: async () => null },
    $transaction: async () => void writes.push('transaction'),
  } as unknown as PrismaService;
  const store = { tenantContext: async () => ({ assessmentEnabled: opts.enabled ?? true }) } as unknown as CaseStore;
  const consent = { hasGranted: async () => opts.consented ?? true } as unknown as ConsentService;
  return { svc: new ChecksService(prisma, store, consent, {} as MemoryService), writes };
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

describe('check access, consent and the kill switch', () => {
  it('scopes every check to its own patient and tenant', async () => {
    const { svc, writes } = service();
    expect(await code(svc.postMessage(principal('someone-else'), 's1', 'hello', 'k1'))).toBe('CHECK_NOT_FOUND');
    expect(await code(svc.answer(principal('someone-else'), 's1', 'q_fever', 1, 'no'))).toBe('CHECK_NOT_FOUND');
    expect(writes).toEqual([]);
  });

  it('stops processing new health information once processing consent is withdrawn', async () => {
    const { svc, writes } = service({ consented: false });
    expect(await code(svc.postMessage(principal('aarav'), 's1', 'my throat hurts', 'k1'))).toBe('CONSENT_REQUIRED');
    expect(await code(svc.answer(principal('aarav'), 's1', 'q_fever', 1, 'no'))).toBe('CONSENT_REQUIRED');
    expect(await code(svc.create(principal('aarav'), 'new-check'))).toBe('CONSENT_REQUIRED');
    expect(writes).toEqual([]);
  });

  it('stops processing when assessments are switched off', async () => {
    const { svc, writes } = service({ enabled: false });
    expect(await code(svc.postMessage(principal('aarav'), 's1', 'my throat hurts', 'k1'))).toBe('ASSESSMENT_UNAVAILABLE');
    expect(writes).toEqual([]);
  });
});
