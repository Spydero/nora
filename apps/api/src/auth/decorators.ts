import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import type { AuthPrincipal } from './auth.types.js';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_ROLES = 'auth:roles';
export const SKIP_CSRF = 'auth:skipCsrf';

/** Route does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires at least one of the listed roles in the active tenant membership. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Route is exempt from CSRF checks (for signed server-to-server callbacks only). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
  const principal = ctx.switchToHttp().getRequest<Request>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a route without an authenticated principal');
  return principal;
});
