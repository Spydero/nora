import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { type DecisionPort, OpenRouterDecisionClient } from './decisions.js';
import { createGeminiModels, createOpenRouterModels, type ModelSet } from './models.js';

const RATE_LIMIT_PAUSE_MS = 2 * 60_000;
const DAY_MS = 24 * 3600 * 1000;

export type ProviderName = 'openrouter' | 'gemini';

export interface AiProvider {
  name: ProviderName;
  label: string;
  models: ModelSet;
  /** Only OpenRouter offers the calibrated decision endpoint; without it ranking falls back to Nora's rules. */
  decisions: DecisionPort | null;
  /** Time zone in which the provider's daily quota resets. */
  quotaResetZone: string;
}

export interface ProviderStatus {
  name: ProviderName;
  label: string;
  model: string;
  available: boolean;
  pausedUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
}

export interface AiStatus {
  configured: boolean;
  available: boolean;
  /** Provider the next assessment will use, or null when all are paused or none is configured. */
  active: ProviderName | null;
  pausedUntil: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  providers: ProviderStatus[];
}

interface ProviderState {
  pausedUntil: number;
  lastError: { message: string; at: Date } | null;
  lastSuccessAt: Date | null;
}

/**
 * Shared model clients, in order of preference. Without any API key Nora runs in labelled
 * template mode. When a provider rate-limits us, it pauses until the limit resets and the
 * next provider takes over, so a spent quota doesn't add a failing round trip to every check.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  readonly providers: AiProvider[] = [];
  readonly maxResearchRounds: number;
  private readonly state = new Map<ProviderName, ProviderState>();

  constructor(config: ConfigService<Env, true>) {
    const timeoutMs = config.get('AI_TIMEOUT_MS', { infer: true });
    this.maxResearchRounds = config.get('AI_MAX_RESEARCH_ROUNDS', { infer: true });

    const openRouterKey = config.get('OPENROUTER_API_KEY', { infer: true });
    if (openRouterKey) {
      const baseUrl = config.get('OPENROUTER_BASE_URL', { infer: true });
      this.providers.push({
        name: 'openrouter',
        label: 'OpenRouter',
        models: createOpenRouterModels({
          apiKey: openRouterKey,
          baseUrl,
          model: config.get('OPENROUTER_MODEL', { infer: true }),
          fastModel: config.get('OPENROUTER_FAST_MODEL', { infer: true }),
          embeddingModel: config.get('OPENROUTER_EMBEDDING_MODEL', { infer: true }),
          timeoutMs,
        }),
        decisions: new OpenRouterDecisionClient(config.get('OPENROUTER_DECISION_MODEL', { infer: true }), openRouterKey, baseUrl, timeoutMs),
        quotaResetZone: 'UTC',
      });
    }

    const geminiKey = config.get('GEMINI_API_KEY', { infer: true });
    if (geminiKey) {
      this.providers.push({
        name: 'gemini',
        label: 'Google Gemini',
        models: createGeminiModels({
          apiKey: geminiKey,
          baseUrl: config.get('GEMINI_BASE_URL', { infer: true }),
          model: config.get('GEMINI_MODEL', { infer: true }),
          fastModel: config.get('GEMINI_FAST_MODEL', { infer: true }),
          timeoutMs,
        }),
        decisions: null,
        quotaResetZone: 'America/Los_Angeles',
      });
    }

    for (const p of this.providers) this.state.set(p.name, { pausedUntil: 0, lastError: null, lastSuccessAt: null });
    if (this.providers.length === 0) this.logger.warn('No AI provider key is set; assessments use approved templates only');
    else this.logger.log(`AI providers in order: ${this.providers.map((p) => `${p.label} (${p.models.chatName})`).join(', ')}`);
  }

  configured(): boolean {
    return this.providers.length > 0;
  }

  /** The first provider that isn't paused, skipping any already tried for this run. */
  next(now = Date.now(), skip: ProviderName[] = []): AiProvider | null {
    return this.providers.find((p) => !skip.includes(p.name) && now >= this.state.get(p.name)!.pausedUntil) ?? null;
  }

  available(now = Date.now()): boolean {
    return this.next(now) !== null;
  }

  /** Feeds the outcome of a run's model calls back into that provider's pause state. */
  record(provider: AiProvider, errors: string[], now = new Date()) {
    const state = this.state.get(provider.name)!;
    if (errors.length === 0) {
      state.lastSuccessAt = now;
      return;
    }
    const message = errors.join(' | ');
    state.lastError = { message: message.slice(0, 300), at: now };
    const until = pauseUntil(message, now, provider.quotaResetZone);
    if (until > state.pausedUntil) {
      state.pausedUntil = until;
      this.logger.warn(`${provider.label} rate-limited; paused until ${new Date(until).toISOString()}`);
    }
  }

  status(now = Date.now()): AiStatus {
    const providers = this.providers.map((p): ProviderStatus => {
      const s = this.state.get(p.name)!;
      return {
        name: p.name,
        label: p.label,
        model: p.models.chatName,
        available: now >= s.pausedUntil,
        pausedUntil: s.pausedUntil > now ? new Date(s.pausedUntil).toISOString() : null,
        lastError: s.lastError?.message ?? null,
        lastErrorAt: s.lastError?.at.toISOString() ?? null,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      };
    });
    const active = this.next(now);
    const latest = <K extends 'lastErrorAt' | 'lastSuccessAt'>(key: K) =>
      providers.filter((p) => p[key]).sort((a, b) => (b[key]! > a[key]! ? 1 : -1))[0] ?? null;
    const lastFailing = latest('lastErrorAt');
    const paused = providers.map((p) => p.pausedUntil).filter((v): v is string => !!v);
    return {
      configured: this.configured(),
      available: !!active,
      active: active?.name ?? null,
      pausedUntil: active || paused.length === 0 ? null : paused.sort()[0]!,
      lastError: lastFailing?.lastError ?? null,
      lastErrorAt: lastFailing?.lastErrorAt ?? null,
      lastSuccessAt: latest('lastSuccessAt')?.lastSuccessAt ?? null,
      providers,
    };
  }
}

/** Errors that mean the provider, not the case, is the problem, so another provider is worth trying. */
export function isProviderFailure(message: string): boolean {
  return /\b(429|5\d\d)\b|rate limit|quota|overloaded|high demand|timed? ?out|ECONNRESET|ECONNREFUSED|fetch failed/i.test(message);
}

/** Epoch ms of the next local midnight in `timeZone`. */
export function nextMidnight(now: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + now.getUTCMilliseconds();
  return now.getTime() - elapsed + DAY_MS;
}

/** A daily quota resets at the provider's midnight; other rate limits are short-lived. */
export function pauseUntil(message: string, now: Date, quotaResetZone = 'UTC'): number {
  const retryIn = /\b429\b[\s\S]*retry in ([\d.]+)\s*s/i.exec(message);
  if (retryIn) return now.getTime() + Math.max(5_000, Math.ceil(Number(retryIn[1]) * 1000));
  if (/per[- ]?day|daily/i.test(message) && /429|rate limit|quota/i.test(message)) return nextMidnight(now, quotaResetZone);
  if (/\b429\b|rate limit|RESOURCE_EXHAUSTED/i.test(message)) return now.getTime() + RATE_LIMIT_PAUSE_MS;
  return 0;
}
