import { Global, Injectable, Module } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  subjectUserId?: string | null;
  purpose?: string;
  /** Identifiers and counts only; never clinical content. */
  metadata?: Record<string, string | number | boolean | null>;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(principal: AuthPrincipal, entry: AuditEntry, db: Db = this.prisma) {
    await db.auditEvent.create({
      data: {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        subjectUserId: entry.subjectUserId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        purpose: entry.purpose,
        metadata: entry.metadata ?? {},
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
