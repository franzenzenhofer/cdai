import { defineConfig } from 'vitest/config';

const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    pool: 'forks',
    /**
     * Serial on purpose. These tests spawn real node and zsh processes against real temp
     * trees, and test/latency.test.ts asserts a wall-clock budget. Parallel workers compete
     * for the same cores and turn that measurement into noise.
     */
    fileParallelism: false,
  },
});
