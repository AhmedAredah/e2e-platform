import type { E2EConfig } from '@e2e-cpp/core';

export default {
  projectId: 'dev.e2e.examples.cpp-cli',
  tests: ['tests/calculator.e2e.ts'],
  targets: [{ name: 'cpp-cli', platform: 'cpp-cli' }],
  workers: 1,
  retries: 0,
  modelPolicy: 'forbid',
  reporters: ['list', 'markdown'],
} satisfies E2EConfig;
