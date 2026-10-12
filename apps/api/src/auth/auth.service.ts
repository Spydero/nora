import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../common/app.exception.js';
import type { Env } from '../config/env.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenClaims, AuthPrincipal } from './auth.types.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { PasswordService } from './password.service.js';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessMaxAgeMs: number;
  refreshToken: string;
  refreshMaxAgeMs: number;
}

/** Refresh reuse inside this window is treated as a concurrent-tab race rather than token theft. */
const REFRESH_RACE_WINDOW_MS = 10_000;
/** Avoid a database write on every request; idle tracking only needs minute-level accuracy. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

const invalidCredentials = () =>
  new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'The organisation, email or password is incorrect.');

const sessionEnded = (code = 'SESSION_ENDED') =>
  new AppException(HttpStatus.UNAUTHORIZED, code, 'Your session has ended. Please sign in again.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(input: LoginInput, meta: RequestMeta) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: input.tenantSlug } });
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk = await this.passwords.verify(user?.passwordHash, input.password);

    const membership =
      tenant && user
        ? await this.prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } })
        : null;

    const failure =
      !tenant || tenant.status !== 'ACTIVE'
        ? 'tenant_unavailable'
        : !user || !passwordOk
          ? 'bad_credentials'
          : user.status !== 'ACTIVE'
            ? 'user_disabled'
            : !membership || membership.status !== 'ACTIVE'
              ? 'no_active_membership'
              : null;

    if (failure || !tenant || !user || !membership) {
      await this.recordAccess({ action: 'auth.login', outcome: 'FAILURE', reason: failure ?? 'unknown', tenantId: tenant?.id, userId: user?.id, meta });
      throw invalidCredentials();
    }

    const tokens = await this.startSession(user.id, membership.id, tenant.id, meta);
    await this.recordAccess({ action: 'auth.login', outcome: 'SUCCESS', tenantId: tenant.id, userId: user.id, sessionId: tokens.sessionId, meta });
    return tokens;
  }

  async registerPatient(input: RegisterInput, meta: RequestMeta) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: input.tenantSlug } });
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!tenant || tenant.status !== 'ACTIVE' || existing) {
      await this.recordAccess({
        action: 'auth.register',
        outcome: 'FAILURE',
        reason: existing ? 'email_in_use' : 'tenant_unavailable',
        tenantId: tenant?.id,
        meta,
      });
      throw new AppException(
        HttpStatus.CONFLICT,
        'REGISTRATION_UNAVAILABLE',
        'We could not create an account with these details. If you already have an account, sign in instead.',
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, displayName: input.displayName, passwordHash },
      });
      const membership = await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, roles: [Role.PATIENT] },
      });
      return { user, membership };
    });

    const tokens = await this.startSession(user.id, membership.id, tenant.id, meta);
    await this.recordAccess({ action: 'auth.register', outcome: 'SUCCESS', tenantId: tenant.id, userId: user.id, sessionId: tokens.sessionId, meta });
    return tokens;
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens & { sessionId: string }> {
    if (!refreshToken) throw sessionEnded();

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { session: { include: { membership: { include: { tenant: true, user: true } } } } },
    });
    if (!record) throw sessionEnded();

    const { session } = record;
    const now = new Date();

    if (record.usedAt) {
      if (now.getTime() - record.usedAt.getTime() < REFRESH_RACE_WINDOW_MS) {
        throw new AppException(HttpStatus.UNAUTHORIZED, 'REFRESH_RACE', 'Session was refreshed in another request.', true);
      }
      await this.revokeSession(session.id, 'refresh_token_reuse');
      await this.recordAccess({ action: 'auth.refresh', outcome: 'FAILURE', reason: 'refresh_token_reuse', tenantId: session.membership.tenantId, userId: session.userId, sessionId: session.id, meta });
      this.logger.warn({ sessionId: session.id, correlationId: meta.correlationId }, 'Refresh token reuse detected; session revoked');
      throw sessionEnded();
    }

    const inactiveReason = this.inactiveReason(session, now);
    if (record.expiresAt <= now || inactiveReason) {
      if (inactiveReason && !session.revokedAt) await this.revokeSession(session.id, inactiveReason);
      throw sessionEnded();
    }

    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count === 0) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'REFRESH_RACE', 'Session was refreshed in another request.', true);
    }

    await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    const tokens = await this.issueTokens(session.id, session.userId, session.membershipId, session.membership.tenantId, session.expiresAt);
    return { ...tokens, sessionId: session.id };
  }

  async logout(sessionId: string | undefined, refreshToken: string | undefined, meta: RequestMeta) {
    let id = sessionId;
    if (!id && refreshToken) {
      const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
      id = record?.sessionId;
    }
    if (!id) return;

    const session = await this.prisma.session.findUnique({ where: { id }, include: { membership: true } });
    if (!session || session.revokedAt) return;
    await this.revokeSession(id, 'logout');
    await this.recordAccess({ action: 'auth.logout', outcome: 'SUCCESS', tenantId: session.membership.tenantId, userId: session.userId, sessionId: id, meta });
  }

  /**
   * Verifies the access token and re-checks the session, membership, user and tenant on every call
   * so revocation and role changes take effect on the next request (F01 AC02).
   */
  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(accessToken, {
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        audience: this.config.get('JWT_AUDIENCE', { infer: true }),
        algorithms: ['HS256'],
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        expired ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID',
        expired ? 'Your session needs to be refreshed.' : 'Please sign in to continue.',
        expired,
      );
    }
    if (claims.typ !== 'access') throw sessionEnded('ACCESS_TOKEN_INVALID');

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      include: { membership: { include: { tenant: true, user: true } } },
    });
    const now = new Date();
    if (!session || session.userId !== claims.sub || session.membershipId !== claims.mid || session.membership.tenantId !== claims.tid) {
      throw sessionEnded();
    }

    const inactiveReason = this.inactiveReason(session, now);
    if (inactiveReason) {
      if (!session.revokedAt) await this.revokeSession(session.id, inactiveReason);
      throw sessionEnded();
    }

    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    return {
      userId: session.userId,
      tenantId: session.membership.tenantId,
      membershipId: session.membershipId,
      sessionId: session.id,
      roles: session.membership.roles,
    };
  }

  async profile(principal: AuthPrincipal) {
    const membership = await this.prisma.membership.findUniqueOrThrow({
      where: { id: principal.membershipId },
      include: { tenant: true, user: true },
    });
    const settings = (membership.tenant.settings ?? {}) as { emergencyNumber?: string; crisisLine?: { name: string; number: string } };
    return {
      user: { id: membership.user.id, email: membership.user.email, displayName: membership.user.displayName },
      tenant: {
        id: membership.tenant.id,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        emergency: { number: settings.emergencyNumber ?? '112', crisisLine: settings.crisisLine ?? null },
      },
      roles: membership.roles,
      session: { id: principal.sessionId, idleTimeoutMinutes: this.idleTimeoutMinutes(membership.roles) },
    };
  }

  private async startSession(userId: string, membershipId: string, tenantId: string, meta: RequestMeta) {
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        membershipId,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 512),
      },
    });
    const tokens = await this.issueTokens(session.id, userId, membershipId, tenantId, expiresAt);
    return { ...tokens, sessionId: session.id };
  }

  private async issueTokens(
    sessionId: string,
    userId: string,
    membershipId: string,
    tenantId: string,
    sessionExpiresAt: Date,
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    const claims: AccessTokenClaims = { sub: userId, tid: tenantId, mid: membershipId, sid: sessionId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: accessTtl,
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      audience: this.config.get('JWT_AUDIENCE', { infer: true }),
      algorithm: 'HS256',
    });

    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { sessionId, tokenHash: hashToken(refreshToken), expiresAt: sessionExpiresAt },
    });

    return {
      accessToken,
      accessMaxAgeMs: accessTtl * 1000,
      refreshToken,
      refreshMaxAgeMs: Math.max(0, sessionExpiresAt.getTime() - Date.now()),
    };
  }

  private inactiveReason(
    session: {
      revokedAt: Date | null;
      expiresAt: Date;
      lastSeenAt: Date;
      membership: { status: string; roles: Role[]; tenant: { status: string }; user: { status: string } };
    },
    now: Date,
  ): string | null {
    if (session.revokedAt) return 'revoked';
    if (session.expiresAt <= now) return 'expired';
    if (session.membership.status !== 'ACTIVE') return 'membership_revoked';
    if (session.membership.user.status !== 'ACTIVE') return 'user_disabled';
    if (session.membership.tenant.status !== 'ACTIVE') return 'tenant_inactive';
    const idleMs = this.idleTimeoutMinutes(session.membership.roles) * 60_000;
    if (now.getTime() - session.lastSeenAt.getTime() > idleMs) return 'idle_timeout';
    return null;
  }

  private idleTimeoutMinutes(roles: Role[]): number {
    const staff = roles.some((role) => role !== Role.PATIENT);
    return staff
      ? this.config.get('STAFF_IDLE_TIMEOUT_MINUTES', { infer: true })
      : this.config.get('PATIENT_IDLE_TIMEOUT_MINUTES', { infer: true });
  }

  private async revokeSession(sessionId: string, reason: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async recordAccess(event: {
    action: string;
    outcome: 'SUCCESS' | 'FAILURE';
    reason?: string;
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    meta: RequestMeta;
  }) {
    await this.prisma.accessEvent.create({
      data: {
        action: event.action,
        outcome: event.outcome,
        reason: event.reason,
        tenantId: event.tenantId,
        userId: event.userId,
        sessionId: event.sessionId,
        ipAddress: event.meta.ipAddress,
        correlationId: event.meta.correlationId,
      },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
