import { Injectable } from '@nestjs/common';
import { type BundleContent, bundleContentSchema } from '../clinical/bundle.schema.js';
import type { FactMap, FactStateName } from '../clinical/rules-engine.js';
import type { EmergencyContacts } from '../assessment/graph/compose.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type Db = PrismaService | Prisma.TransactionClient;

export interface FactProvenance {
  quote?: string;
  assertion?: string;
  sourceMessageId?: string;
}

export interface TenantContext {
  emergency: EmergencyContacts;
  assessmentEnabled: boolean;
  aiEnabled: boolean;
  reviewSlaHours: number;
}

/** Persistence helpers shared by the request path and the assessment worker. */
@Injectable()
export class CaseStore {
  private readonly bundles = new Map<string, BundleContent>();

  constructor(private readonly prisma: PrismaService) {}

  /** Bundles are immutable once released, so parsed content is cached by id. */
  async bundle(id: string): Promise<BundleContent> {
    const cached = this.bundles.get(id);
    if (cached) return cached;
    const row = await this.prisma.clinicalBundle.findUniqueOrThrow({ where: { id } });
    const parsed = bundleContentSchema.parse(row.content);
    this.bundles.set(id, parsed);
    return parsed;
  }

  async tenantContext(tenantId: string): Promise<TenantContext> {
    const [tenant, flags] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.platformFlag.findMany({ where: { key: { in: ['assessment', 'ai_generation'] } } }),
    ]);
    const settings = (tenant.settings ?? {}) as { emergencyNumber?: string; crisisLine?: { name: string; number: string }; reviewSlaHours?: number };
    const flagOn = (key: string) => flags.find((f) => f.key === key)?.enabled ?? true;
    return {
      emergency: { number: settings.emergencyNumber ?? '112', crisisLine: settings.crisisLine ?? null },
      assessmentEnabled: tenant.capabilities.includes('assessment') && flagOn('assessment'),
      aiEnabled: tenant.capabilities.includes('ai_generation') && flagOn('ai_generation'),
      reviewSlaHours: settings.reviewSlaHours ?? 24,
    };
  }

  async facts(db: Db, sessionId: string): Promise<FactMap> {
    const rows = await db.caseFact.findMany({ where: { sessionId, supersededAt: null }, orderBy: { createdAt: 'asc' } });
    return Object.fromEntries(
      rows.map((r) => [r.key, { state: r.state as FactStateName, value: typeof r.value === 'number' ? r.value : null, source: r.source }]),
    );
  }

  /** Supersedes the previous row for each key; history is kept for provenance. */
  async writeFacts(db: Db, sessionId: string, changes: FactMap, inputVersion: number, provenance: Record<string, FactProvenance> = {}) {
    const keys = Object.keys(changes);
    if (keys.length === 0) return;
    await db.caseFact.updateMany({ where: { sessionId, key: { in: keys }, supersededAt: null }, data: { supersededAt: new Date() } });
    await db.caseFact.createMany({
      data: keys.map((key) => {
        const f = changes[key]!;
        const p = provenance[key] ?? {};
        return {
          sessionId,
          key,
          state: f.state,
          value: f.value ?? Prisma.DbNull,
          source: f.source ?? 'unknown',
          sourceMessageId: p.sourceMessageId,
          quote: p.quote?.slice(0, 500),
          assertion: p.assertion,
          confirmed: f.source === 'answer' || f.source === 'profile',
          inputVersion,
        };
      }),
    });
  }

  async askedQuestions(db: Db, sessionId: string): Promise<string[]> {
    const rows = await db.answer.findMany({ where: { sessionId, supersededAt: null }, select: { questionId: true } });
    return [...new Set(rows.map((r) => r.questionId))];
  }

  async event(db: Db, sessionId: string, type: string, payload: Record<string, unknown> = {}) {
    await db.sessionEvent.create({ data: { sessionId, type, payload: payload as Prisma.InputJsonValue } });
  }
}
