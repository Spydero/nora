import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AiService, isProviderFailure, nextMidnight, pauseUntil } from './ai.service.js';

const DAILY = 'extraction: 429 Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day';

function service(keys: { openrouter?: string; gemini?: string }) {
  const values: Partial<Env> = {
    OPENROUTER_API_KEY: keys.openrouter ?? '',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_MODEL: 'or-chat',
    OPENROUTER_FAST_MODEL: 'or-fast',
    OPENROUTER_DECISION_MODEL: 'or-decide',
    OPENROUTER_EMBEDDING_MODEL: 'or-embed',
    GEMINI_API_KEY: keys.gemini ?? '',
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    GEMINI_MODEL: 'gemini-chat',
    GEMINI_FAST_MODEL: 'gemini-fast',
    AI_TIMEOUT_MS: 1000,
    AI_MAX_RESEARCH_ROUNDS: 2,
  };
  return new AiService({ get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>);
}

describe('AI rate-limit pause', () => {
  const now = new Date('2026-10-12T17:45:00Z');

  it('pauses until the daily quota resets at midnight UTC', () => {
    expect(new Date(pauseUntil(DAILY, now)).toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('uses the provider’s own reset time zone', () => {
    const gemini = 'research: 429 Quota exceeded for metric generate_content_free_tier_requests, limit: GenerateRequestsPerDayPerProjectPerModel';
    expect(new Date(pauseUntil(gemini, now, 'America/Los_Angeles')).toISOString()).toBe('2026-10-13T07:00:00.000Z');
  });

  it('follows the provider’s retry hint for a per-minute limit', () => {
    const msg = 'research: 429 Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash Please retry in 41.02s.';
    expect(pauseUntil(msg, now, 'America/Los_Angeles')).toBe(now.getTime() + 41_020);
  });

  it('pauses briefly for an ordinary rate limit', () => {
    expect(pauseUntil('research: 429 Too Many Requests', now)).toBe(now.getTime() + 120_000);
  });

  it('does not pause for other failures', () => {
    expect(pauseUntil('decisions: timeout after 30000ms', now)).toBe(0);
  });

  it('computes the next local midnight', () => {
    expect(new Date(nextMidnight(new Date('2026-10-12T23:59:59Z'), 'UTC')).toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(new Date(nextMidnight(new Date('2026-10-12T18:30:00Z'), 'Asia/Kolkata')).toISOString()).toBe('2026-10-13T18:30:00.000Z');
  });
});

describe('provider failover', () => {
  it('runs in template mode with no keys', () => {
    const ai = service({});
    expect(ai.configured()).toBe(false);
    expect(ai.next()).toBeNull();
  });

  it('prefers OpenRouter and falls back to Gemini once OpenRouter’s daily quota is spent', () => {
    const ai = service({ openrouter: 'or', gemini: 'gm' });
    const first = ai.next()!;
    expect(first.name).toBe('openrouter');
    expect(first.decisions).not.toBeNull();

    ai.record(first, [DAILY]);
    const second = ai.next()!;
    expect(second.name).toBe('gemini');
    expect(second.decisions).toBeNull();
    expect(second.models.chatName).toBe('gemini-chat');

    const status = ai.status();
    expect(status.active).toBe('gemini');
    expect(status.available).toBe(true);
    expect(status.providers.find((p) => p.name === 'openrouter')?.pausedUntil).not.toBeNull();
  });

  it('reports a pause only when every provider is paused', () => {
    const ai = service({ openrouter: 'or', gemini: 'gm' });
    ai.record(ai.next()!, [DAILY]);
    ai.record(ai.next()!, ['research: 429 quota exceeded per day']);
    expect(ai.next()).toBeNull();
    expect(ai.status().pausedUntil).not.toBeNull();
  });

  it('skips providers already tried in this run', () => {
    const ai = service({ openrouter: 'or', gemini: 'gm' });
    expect(ai.next(Date.now(), ['openrouter'])?.name).toBe('gemini');
    expect(ai.next(Date.now(), ['openrouter', 'gemini'])).toBeNull();
  });

  it('treats provider-side errors as worth retrying elsewhere, but not case problems', () => {
    expect(isProviderFailure('research: 503 This model is currently experiencing high demand')).toBe(true);
    expect(isProviderFailure('extraction: Request timed out.')).toBe(true);
    expect(isProviderFailure(DAILY)).toBe(true);
    expect(isProviderFailure('draft: cited unknown evidence E9')).toBe(false);
  });
});
