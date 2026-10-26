import type { E2EConfig } from '@e2e-cpp/core';
import { createAgent } from '@e2e-cpp/core/agent';
import { playwright } from '@e2e-cpp/playwright';
import { gateway } from 'ai';

export default {
  agents: {
    default: createAgent({
      model: gateway('openai/gpt-5.6-luna'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    }),
  },
  targets: [{
    engine: playwright({
      url: process.env.APP_URL ?? 'http://localhost:3000',
      command: {
        executable: 'npm',
        args: ['run', 'dev'],
        reuseExisting: true,
        log: '.e2e/logs/app.log',
      },
    }),
  }],
} satisfies E2EConfig;
