import type { Role } from '../generated/prisma/enums.js';

/** Claims in the signed access token. Roles are re-read from the database on every request. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  mid: string;
  sid: string;
  typ: 'access';
}

/** The authenticated actor attached to each request after session checks pass. */
export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
  roles: Role[];
}
