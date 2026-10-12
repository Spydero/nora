import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppException } from '../common/app.exception.js';
import type { Env } from '../config/env.js';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies.js';
import { SKIP_CSRF } from './decorators.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;

    const origin = req.header('origin');
    if (origin && origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CSRF_ORIGIN_MISMATCH', 'This request was blocked.');
    }

    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.header(CSRF_HEADER);
    if (typeof cookie !== 'string' || !header || !safeEqual(cookie, header)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'CSRF_TOKEN_INVALID',
        'Your session security token is missing or expired. Refresh the page and try again.',
        true,
      );
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
