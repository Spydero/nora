import type { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'nora_at';
export const REFRESH_COOKIE = 'nora_rt';
export const CSRF_COOKIE = 'nora_csrf';
/** Non-secret marker so the web app can tell a refreshable session exists without seeing the refresh token. */
export const SESSION_HINT_COOKIE = 'nora_session';
export const CSRF_HEADER = 'x-csrf-token';

/** Refresh cookie is only sent to auth endpoints, never to ordinary API routes. */
const REFRESH_PATH = '/api/v1/auth';

function base(secure: boolean): CookieOptions {
  return { secure, sameSite: 'lax', path: '/' };
}

export function setAuthCookies(
  res: Response,
  opts: { accessToken: string; accessMaxAgeMs: number; refreshToken: string; refreshMaxAgeMs: number; secure: boolean },
) {
  res.cookie(ACCESS_COOKIE, opts.accessToken, {
    ...base(opts.secure),
    httpOnly: true,
    maxAge: opts.accessMaxAgeMs,
  });
  res.cookie(REFRESH_COOKIE, opts.refreshToken, {
    ...base(opts.secure),
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: opts.refreshMaxAgeMs,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', { ...base(opts.secure), httpOnly: true, maxAge: opts.refreshMaxAgeMs });
}

export function clearAuthCookies(res: Response, secure: boolean) {
  res.clearCookie(SESSION_HINT_COOKIE, { ...base(secure), httpOnly: true });
  res.clearCookie(ACCESS_COOKIE, { ...base(secure), httpOnly: true });
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), httpOnly: true, sameSite: 'strict', path: REFRESH_PATH });
}

/** Double-submit CSRF token: readable by the web app, echoed back in the x-csrf-token header. */
export function setCsrfCookie(res: Response, token: string, secure: boolean) {
  res.cookie(CSRF_COOKIE, token, { ...base(secure), httpOnly: false, sameSite: 'strict' });
}
