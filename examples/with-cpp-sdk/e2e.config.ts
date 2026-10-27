import type { E2EConfig } from '@e2e-platform/core';
export default {
  modelPolicy: 'forbid', workers: 1, retries: 0,
  tests: './tests/compiled.e2e.ts',
  targets: [{ name: 'cpp-sdk', platform: 'cpp-cli' }],
} satisfies E2EConfig;
