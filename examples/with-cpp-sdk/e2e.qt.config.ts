import type { E2EConfig } from '@e2e-platform/core';
import { qt } from '@e2e-platform/native';
const appPath = process.env['E2E_QT_DEMO'];
if (!appPath) throw new Error('Set E2E_QT_DEMO to the compiled Qt application');
export default {
  modelPolicy: 'forbid', workers: 1, retries: 0,
  tests: './tests/compiled.e2e.ts',
  targets: [{ name: 'cpp-sdk-qt', engine: qt(), app: { appPath } }],
} satisfies E2EConfig;
