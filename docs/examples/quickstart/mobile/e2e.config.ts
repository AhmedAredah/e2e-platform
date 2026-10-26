import type { E2EConfig } from '@e2e-platform/core';
import { createAgent } from '@e2e-platform/core/agent';
import { agentDevice } from '@e2e-platform/agent-device';
import { gateway } from 'ai';

export default {
  agents: { default: createAgent({ model: gateway('openai/gpt-5.6-luna') }) },
  targets: [{ name: 'ios', engine: agentDevice({ platform: 'ios', app: 'Settings' }) }],
  workers: 1,
} satisfies E2EConfig;
