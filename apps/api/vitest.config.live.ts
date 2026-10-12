import { defineConfig } from 'vitest/config';

/** Opt-in tests that call real OpenRouter models. Requires OPENROUTER_API_KEY. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.live-spec.ts'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
});
