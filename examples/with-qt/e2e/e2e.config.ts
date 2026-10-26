import { fileURLToPath } from 'node:url';
import type { E2EConfig } from '@e2e-cpp/core';
import { qt } from '@e2e-cpp/native';

const executable = process.platform === 'win32' ? '../build/Release/e2e_qt_demo.exe' : '../build/e2e_qt_demo';

export default {
  modelPolicy: 'forbid',
  tests: './tests/**/*.e2e.ts',
  targets: [{
    name: 'qt-widgets',
    engine: qt(),
    app: {
      appPath: process.env.E2E_QT_DEMO ?? fileURLToPath(new URL(executable, import.meta.url)),
      launchArguments: process.env.E2E_QT_BAD_CALCULATION === '1' ? ['--bad-calculation'] : [],
    },
  }],
  workers: 1,
} satisfies E2EConfig;
