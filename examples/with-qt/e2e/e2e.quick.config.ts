import { fileURLToPath } from 'node:url';
import type { E2EConfig } from '@e2e-cpp/core';
import { qt } from '@e2e-cpp/native';

const executable = process.platform === 'win32' ? '../build/Release/e2e_qt_quick_demo.exe' : '../build/e2e_qt_quick_demo';

export default {
  modelPolicy: 'forbid',
  tests: './tests-quick/**/*.e2e.ts',
  targets: [{
    name: 'qt-quick',
    engine: qt({ actions: ['tap', 'fill', 'clear', 'focus', 'press', 'check', 'uncheck', 'hover'] }),
    app: { appPath: process.env.E2E_QT_QUICK_DEMO ?? fileURLToPath(new URL(executable, import.meta.url)) },
  }],
  workers: 1,
} satisfies E2EConfig;
