import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { type LoginInput, loginSchema, type RegisterInput, registerSchema } from './auth.schemas.js';
import { AuthService, type IssuedTokens, type RequestMeta } from './auth.service.js';
import type { AuthPrincipal } from './auth.types.js';
import { ACCESS_COOKIE, clearAuthCookies, CSRF_COOKIE, REFRESH_COOKIE, setAuthCookies, setCsrfCookie } from './cookies.js';
import { CurrentPrincipal, Public } from './decorators.js';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && existing.length >= 32 ? existing : randomBytes(32).toString('base64url');
    setCsrfCookie(res, token, this.secure);
    return { csrfToken: token };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(body, meta(req));
    this.applyTokens(res, tokens);
    return this.auth.profile(await this.auth.authenticate(tokens.accessToken));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.registerPatient(body, meta(req));
    this.applyTokens(res, tokens);
    return this.auth.profile(await this.auth.authenticate(tokens.accessToken));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const tokens = await this.auth.refresh(readCookie(req, REFRESH_COOKIE), meta(req));
      this.applyTokens(res, tokens);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'REFRESH_RACE')) {
        clearAuthCookies(res, this.secure);
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let sessionId: string | undefined;
    const accessToken = readCookie(req, ACCESS_COOKIE);
    if (accessToken) {
      sessionId = await this.auth.authenticate(accessToken).then(
        (principal) => principal.sessionId,
        () => undefined,
      );
    }
    await this.auth.logout(sessionId, readCookie(req, REFRESH_COOKIE), meta(req));
    clearAuthCookies(res, this.secure);
  }

  @Get('me')
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.auth.profile(principal);
  }

  private get secure() {
    return this.config.get('COOKIE_SECURE', { infer: true });
  }

  private applyTokens(res: Response, tokens: IssuedTokens) {
    setAuthCookies(res, { ...tokens, secure: this.secure });
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === 'string' && value ? value : undefined;
}

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.header('user-agent'), correlationId: req.correlationId };
}
