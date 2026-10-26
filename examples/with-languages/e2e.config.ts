import type { E2EConfig } from '@e2e-platform/core';

export default {
  projectId: 'dev.e2e.examples.languages',
  tests: ['tests/calculator.e2e.ts'],
  targets: ['python', 'dotnet', 'rust'].map((name) => ({ name, platform: name })),
  workers: 1,
  retries: 0,
  timeout: 30_000,
  cleanupTimeout: 5_000,
  artifacts: [],
  cache: 'off',
  modelPolicy: 'forbid',
  reporters: ['list', 'markdown', 'junit'],
} satisfies E2EConfig;
