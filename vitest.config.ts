import { defineConfig } from 'vitest/config';

const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    pool: 'forks',
  },
});
