import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export const analyticsQuerySchema = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') });

const DAY = 24 * 3600 * 1000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
const URGENCIES = ['emergency', 'urgent', 'soon', 'routine', 'self_care'] as const;

/** Counts of 1–4 can point to an individual patient in a small tenant, so they are withheld. */
export const MIN_COUNT = 5;

export function suppress(n: number): number | null {
  return n > 0 && n < MIN_COUNT ? null : n;
}

/** A percentage, withheld when the part or the remainder is small, since the rate would reveal it. */
export function share(part: number, whole: number): number | null {
  if (whole < MIN_COUNT || suppress(part) === null || suppress(whole - part) === null) return null;
  return Math.round((part / whole) * 100);
}

/**
 * Counts that add up to a published total. A single withheld cell could be recovered by
 * subtraction, so the next smallest non-zero cell is withheld with it.
 */
export function suppressBreakdown(counts: number[]): (number | null)[] {
  const out = counts.map(suppress);
  if (out.filter((c) => c === null).length !== 1) return out;
  let partner = -1;
  out.forEach((c, i) => {
    if (c !== null && c > 0 && (partner < 0 || c < counts[partner]!)) partner = i;
  });
  if (partner >= 0) out[partner] = null;
  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiService,
  ) {}

  /** Tenant analytics (F28). Aggregates only: no symptoms, messages or patient identities leave this method. */
  async analytics(tenantId: string, range: keyof typeof RANGE_DAYS, now = new Date()) {
    const since = new Date(now.getTime() - RANGE_DAYS[range] * DAY);
    const inRange = { tenantId, createdAt: { gte: since } };
    const [started, completed, followUps, results, referrals, tasks, failedJobs] = await Promise.all([
      this.prisma.assessmentSession.count({ where: { ...inRange, status: { not: 'DRAFT' } } }),
      this.prisma.assessmentSession.count({ where: { ...inRange, status: { not: 'DRAFT' }, currentResultId: { not: null } } }),
      this.prisma.assessmentSession.count({ where: { ...inRange, parentSessionId: { not: null } } }),
      this.prisma.assessmentResult.findMany({ where: { ...inRange, supersededAt: null }, select: { status: true, urgency: true, generator: true } }),
      this.prisma.referral.count({ where: inRange }),
      this.prisma.reviewTask.findMany({ where: inRange, select: { status: true, createdAt: true, decisions: { select: { decision: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
      this.prisma.outboxJob.count({ where: { ...inRange, status: 'FAILED' } }),
    ]);

    const assessed = results.length;
    const unsupported = results.filter((r) => r.status === 'UNSUPPORTED').length;
    const escalated = results.filter((r) => r.urgency === 'emergency' || r.urgency === 'urgent').length;
    const breakdown = suppressBreakdown([
      ...URGENCIES.map((level) => results.filter((r) => r.urgency === level && r.status !== 'UNSUPPORTED').length),
      unsupported,
    ]);
    const [emergencyShown, urgentShown, , , , unsupportedShown] = breakdown;
    const aiDrafted = results.filter((r) => r.generator === 'llm').length;
    const aiFellBack = results.filter((r) => r.generator === 'template_fallback').length;

    const decided = tasks.filter((t) => t.decisions[0]);
    const latencies = decided.map((t) => (t.decisions[0]!.createdAt.getTime() - t.createdAt.getTime()) / 3600_000);
    const corrected = decided.filter((t) => t.decisions[0]!.decision === 'CHANGE_URGENCY').length;

    return {
      range,
      since: since.toISOString(),
      minCount: MIN_COUNT,
      funnel: {
        started: suppress(started),
        completed: suppress(completed),
        completionRate: share(completed, started),
        followUps: suppress(followUps),
      },
      outcomes: {
        assessed: suppress(assessed),
        urgentOrEmergency: (emergencyShown === null) !== (urgentShown === null) ? null : suppress(escalated),
        unsupported: unsupportedShown,
        unsupportedRate: unsupportedShown === null ? null : share(unsupported, assessed),
        handoffs: suppress(referrals),
        handoffRate: share(referrals, assessed),
      },
      urgency: URGENCIES.map((level, i) => ({ level, count: breakdown[i]! })),
      safety: {
        reviewsOpened: suppress(tasks.length),
        reviewsDecided: suppress(decided.length),
        reviewsCorrected: suppress(corrected),
        correctionRate: share(corrected, decided.length),
        medianReviewHours: decided.length >= MIN_COUNT ? Math.round(median(latencies)! * 10) / 10 : null,
      },
      ai: {
        used: suppress(aiDrafted),
        fellBack: suppress(aiFellBack),
        fallbackRate: share(aiFellBack, aiDrafted + aiFellBack),
      },
      reliability: { failedAssessments: suppress(failedJobs) },
    };
  }

  /** Platform operator health (F30). Operational signals only; never patient content. */
  async health(now = new Date()) {
    const dayAgo = new Date(now.getTime() - DAY);
    const dbStart = performance.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const dbMs = Math.round(performance.now() - dbStart);
    const redisStart = performance.now();
    const redisOk = await this.redis.ping();
    const redisMs = Math.round(performance.now() - redisStart);

    const [jobs, oldestPending, failed24h, results24h, documents, flags] = await Promise.all([
      this.prisma.outboxJob.groupBy({ by: ['status'], where: { status: { in: ['PENDING', 'RUNNING'] } }, _count: { _all: true } }),
      this.prisma.outboxJob.findFirst({ where: { status: 'PENDING' }, orderBy: { runAfter: 'asc' }, select: { runAfter: true } }),
      this.prisma.outboxJob.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
      this.prisma.assessmentResult.findMany({ where: { createdAt: { gte: dayAgo } }, select: { generator: true, latencyMs: true } }),
      this.prisma.knowledgeDocument.findMany({ where: { status: 'APPROVED' }, select: { title: true, reviewDueAt: true }, orderBy: { reviewDueAt: 'asc' } }),
      this.prisma.platformFlag.findMany(),
    ]);
    const jobCount = (s: string) => jobs.find((j) => j.status === s)?._count._all ?? 0;
    const latencies = results24h.map((r) => r.latencyMs).filter((v): v is number => v !== null);
    const flag = (key: string) => flags.find((f) => f.key === key)?.enabled ?? true;
    const soon = now.getTime() + 30 * DAY;

    return {
      checkedAt: now.toISOString(),
      database: { ok: true, latencyMs: dbMs },
      redis: { ok: redisOk, latencyMs: redisOk ? redisMs : null },
      queue: {
        pending: jobCount('PENDING'),
        running: jobCount('RUNNING'),
        failed24h,
        oldestPendingSeconds: oldestPending ? Math.max(0, Math.round((now.getTime() - oldestPending.runAfter.getTime()) / 1000)) : null,
      },
      assessments24h: {
        total: results24h.length,
        ai: results24h.filter((r) => r.generator === 'llm').length,
        template: results24h.filter((r) => r.generator === 'template').length,
        fellBack: results24h.filter((r) => r.generator === 'template_fallback').length,
        rules: results24h.filter((r) => r.generator === 'rules').length,
        medianMs: median(latencies),
        p95Ms: percentile(latencies, 95),
      },
      ai: { ...this.ai.status(), enabled: flag('ai_generation') },
      assessmentEnabled: flag('assessment'),
      knowledge: {
        approved: documents.length,
        overdue: documents.filter((d) => d.reviewDueAt.getTime() < now.getTime()).map((d) => ({ title: d.title, reviewDueAt: d.reviewDueAt.toISOString() })),
        dueSoon: documents
          .filter((d) => d.reviewDueAt.getTime() >= now.getTime() && d.reviewDueAt.getTime() < soon)
          .map((d) => ({ title: d.title, reviewDueAt: d.reviewDueAt.toISOString() })),
      },
    };
  }
}
