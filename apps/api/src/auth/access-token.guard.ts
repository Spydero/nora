import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../common/app.exception.js';
import type { Role } from '../generated/prisma/enums.js';
import { AuthService } from './auth.service.js';
import { ACCESS_COOKIE } from './cookies.js';
import { IS_PUBLIC, REQUIRED_ROLES } from './decorators.js';

/** Global guard: every route requires a live session unless marked @Public(). */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = extractToken(req);
    if (!token) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in to continue.');
    }

    req.principal = await this.auth.authenticate(token);

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required?.length && !required.some((role) => req.principal?.roles.includes(role))) {
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have access to this resource.');
    }
    return true;
  }
}

function extractToken(req: Request): string | undefined {
  const cookie: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie) return cookie;
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
