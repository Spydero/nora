import type { ConfigService } from '@nestjs/config';
import type { AiService } from '../ai/ai.service.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { demoBundle } from '../clinical/content/demo-bundle.js';
import type { Env } from '../config/env.js';
import { ConsentService } from '../consent/consent.service.js';
import { STOPPED_TEXT } from '../consent/processing-stop.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AssessmentWorker } from './assessment.worker.js';
import type { CaseStore } from './case-store.js';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Matches the handful of Prisma filters these code paths use: equality, `in` and `not`. */
function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown };
      if (c.in) return c.in.includes(row[k]);
      if ('not' in c) return row[k] !== c.not;
    }
    return row[k] === cond;
  });
}

function table(rows: Row[], writes: string[], name: string) {
  return {
    findUnique: async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Where } = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: { data: Row }) => {
      writes.push(name);
      const row = { id: `${name}-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    },
    createMany: async () => void writes.push(name),
    updateMany: async ({ where, data }: { where: Where; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) for (const [k, v] of Object.entries(data)) if (typeof v !== 'object' || v === null || v instanceof Date) r[k] = v;
      return { count: hit.length };
    },
    update: async ({ where, data }: { where: Where; data: Row }) => {
      writes.push(name);
      const row = rows.find((r) => matches(r, where))!;
      Object.assign(row, data);
      return row;
    },
  };
}

function world() {
  const writes: string[] = [];
  const sessions: Row[] = [
    { id: 's1', tenantId: 't1', patientUserId: 'u1', status: 'ASSESSING', inputVersion: 2, bundleId: 'b1', turnCount: 1, parentSessionId: null },
    { id: 's2', tenantId: 't1', patientUserId: 'u1', status: 'ASSESSING', inputVersion: 1, bundleId: 'b1', turnCount: 1, parentSessionId: null },
    { id: 's3', tenantId: 't1', patientUserId: 'someone-else', status: 'ASSESSING', inputVersion: 1, bundleId: 'b1', turnCount: 1, parentSessionId: null },
  ];
  const jobs: Row[] = [
    { id: 'j1', tenantId: 't1', type: 'assess', resourceId: 's1', status: 'RUNNING' },
    { id: 'j2', tenantId: 't1', type: 'assess', resourceId: 's2', status: 'PENDING' },
    { id: 'j3', tenantId: 't1', type: 'assess', resourceId: 's3', status: 'PENDING' },
  ];
  const messages: Row[] = [];
  const events: Row[] = [];
  const consents: Row[] = [];
  const prisma = {
    assessmentSession: table(sessions, writes, 'session'),
    outboxJob: table(jobs, writes, 'job'),
    message: table(messages, writes, 'message'),
    sessionEvent: table(events, writes, 'event'),
    consentRecord: table(consents, writes, 'consent'),
    urgencyDecision: table([], writes, 'urgencyDecision'),
    assessmentResult: table([], writes, 'result'),
    caseFact: table([], writes, 'caseFact'),
    reviewTask: table([], writes, 'reviewTask'),
    medicineEntry: table([], writes, 'medicine'),
    noticeVersion: { findMany: async () => [{ id: 'n1', purpose: 'PROCESSING', tenantId: null, required: true, version: '1', title: 'Processing', body: '' }] },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
  };
  return { prisma, writes, sessions, jobs, messages, events };
}

function worker(w: ReturnType<typeof world>, opts: { consent: boolean[]; enabled?: boolean }) {
  const answers = [...opts.consent];
  const consent = { hasGranted: async () => (answers.length > 1 ? answers.shift()! : answers[0]!) } as unknown as ConsentService;
  let memoryCalls = 0;
  const memory = { forPatient: async () => (memoryCalls++, []) } as unknown as MemoryService;
  const store = {
    bundle: async () => demoBundle,
    tenantContext: async () => ({ assessmentEnabled: opts.enabled ?? true, aiEnabled: false, emergency: { number: '112', crisisLine: null }, reviewSlaHours: 24 }),
    facts: async () => ({}),
    askedQuestions: async () => [],
    writeFacts: async () => void w.writes.push('facts'),
    event: async (db: typeof w.prisma, sessionId: string, type: string, payload: Row = {}) => void (await db.sessionEvent.create({ data: { sessionId, type, payload } })),
  } as unknown as CaseStore;
  const ai = { configured: () => false, available: () => true, next: () => null, maxResearchRounds: 1, record: () => undefined } as unknown as AiService;
  const config = { get: () => false } as unknown as ConfigService<Env, true>;
  const instance = new AssessmentWorker(w.prisma as unknown as PrismaService, store, ai, memory, config, consent);
  const run = () => (instance as unknown as { run(job: unknown): Promise<void> }).run({ id: 'j1', type: 'assess', resource_id: 's1', payload: { inputVersion: 2 }, attempts: 1 });
  return { run, memoryCalls: () => memoryCalls };
}

const ASSESSMENT_WRITES = ['facts', 'caseFact', 'urgencyDecision', 'result', 'reviewTask'];

describe('background assessment rechecks consent', () => {
  it('cancels a queued job without reading or assessing anything once processing consent is withdrawn', async () => {
    const w = world();
    const { run, memoryCalls } = worker(w, { consent: [false] });
    await run();
    expect(w.jobs.find((j) => j.id === 'j1')!.status).toBe('CANCELLED');
    expect(w.sessions.find((s) => s.id === 's1')!.status).toBe('COLLECTING');
    expect(w.messages.map((m) => m.text)).toEqual([STOPPED_TEXT.consent_withdrawn]);
    expect(STOPPED_TEXT.consent_withdrawn).toMatch(/emergency services/);
    expect(memoryCalls()).toBe(0);
    expect(w.writes.filter((x) => ASSESSMENT_WRITES.includes(x))).toEqual([]);
    expect(w.jobs.find((j) => j.id === 'j3')!.status).toBe('PENDING');
  });

  it('cancels queued work when assessments have been switched off', async () => {
    const w = world();
    await worker(w, { consent: [true], enabled: false }).run();
    expect(w.jobs.find((j) => j.id === 'j1')!.status).toBe('CANCELLED');
    expect(w.messages.map((m) => m.text)).toEqual([STOPPED_TEXT.assessment_disabled]);
    expect(w.writes.filter((x) => ASSESSMENT_WRITES.includes(x))).toEqual([]);
  });

  it('writes nothing from a run when consent is withdrawn while it is working', async () => {
    const w = world();
    await worker(w, { consent: [true, false] }).run();
    expect(w.jobs.find((j) => j.id === 'j1')!.status).toBe('CANCELLED');
    expect(w.sessions.find((s) => s.id === 's1')!.status).toBe('COLLECTING');
    expect(w.writes.filter((x) => ASSESSMENT_WRITES.includes(x))).toEqual([]);
    expect(w.messages.map((m) => m.kind)).toEqual(['notice']);
  });

  it('still processes the job while consent stands', async () => {
    const w = world();
    await worker(w, { consent: [true, true] }).run();
    expect(w.jobs.find((j) => j.id === 'j1')!.lastError).toBeUndefined();
    expect(w.jobs.find((j) => j.id === 'j1')!.status).toBe('DONE');
    expect(w.writes).toContain('urgencyDecision');
    expect(w.messages.map((m) => m.kind)).toContain('question');
  });
});

describe('withdrawing processing consent', () => {
  const principal = { tenantId: 't1', userId: 'u1', role: 'PATIENT' } as unknown as AuthPrincipal;
  const consentService = (w: ReturnType<typeof world>) => {
    const svc = new ConsentService(w.prisma as unknown as PrismaService);
    (svc as unknown as { list: () => Promise<unknown[]> }).list = async () => [];
    return svc;
  };

  it('stops the patient’s queued and running assessments and hands their checks back', async () => {
    const w = world();
    await consentService(w).record(principal, 'PROCESSING', false);
    expect(w.jobs.filter((j) => j.resourceId !== 's3').map((j) => j.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(w.sessions.filter((s) => s.patientUserId === 'u1').map((s) => s.status)).toEqual(['COLLECTING', 'COLLECTING']);
    expect(w.messages.map((m) => m.text)).toEqual([STOPPED_TEXT.consent_withdrawn, STOPPED_TEXT.consent_withdrawn]);
  });

  it('leaves other patients’ work alone', async () => {
    const w = world();
    await consentService(w).record(principal, 'PROCESSING', false);
    expect(w.jobs.find((j) => j.resourceId === 's3')!.status).toBe('PENDING');
    expect(w.sessions.find((s) => s.id === 's3')!.status).toBe('ASSESSING');
  });

  it('cancels nothing when consent is granted', async () => {
    const w = world();
    await consentService(w).record(principal, 'PROCESSING', true);
    expect(w.jobs.map((j) => j.status)).toEqual(['RUNNING', 'PENDING', 'PENDING']);
    expect(w.messages).toEqual([]);
  });
});
