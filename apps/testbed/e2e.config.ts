import type { E2EConfig } from '@e2e-cpp/core';
import { playwright } from '@e2e-cpp/playwright';

export default {
  specVersion: '0.1',
  projectId: 'dev.e2e.testbed',
  targets: [
    {
      name: 'web',
      engine: playwright({
        url: 'http://127.0.0.1:4271',
        command: { executable: 'node', args: ['app/server.mjs'], env: { PORT: '4271' } },
      }),
    },
  ],
  credentials: {
    admin: {
      username: 'admin',
      password: 'admin-pass',
    },
  },
} satisfies E2EConfig;
