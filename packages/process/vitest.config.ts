import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'], testTimeout: 15_000, pool: 'forks', maxWorkers: 3 },
});
