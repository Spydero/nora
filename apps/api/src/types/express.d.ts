import type { AuthPrincipal } from '../auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      principal?: AuthPrincipal;
    }
  }
}

export {};
