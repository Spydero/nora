import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  WEB_ORIGIN: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('nora-api'),
  JWT_AUDIENCE: z.string().default('nora-web'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  PATIENT_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  STAFF_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  COOKIE_SECURE: booleanString,

  /** Empty means AI generation is off: Nora runs in labelled template mode. */
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
  /** Tool-calling reasoning model: research agent, extraction and drafting. */
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3.5-lightning:free'),
  OPENROUTER_FAST_MODEL: z.string().default('nvidia/nemotron-3.5-lightning:free'),
  /** Calibrated classifier on /api/alpha/decisions: ranks candidates and cross-checks urgency. */
  OPENROUTER_DECISION_MODEL: z.string().default('inception/mercury-decide:free'),
  OPENROUTER_EMBEDDING_MODEL: z.string().default('nvidia/llama-nemotron-embed-vl-1b-v2:free'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MAX_RESEARCH_ROUNDS: z.coerce.number().int().min(0).max(5).default(3),
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
