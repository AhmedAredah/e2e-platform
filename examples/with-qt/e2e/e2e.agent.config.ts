import { gateway } from 'ai';
import config from './e2e.config.ts';

export default {
  ...config,
  modelPolicy: 'allow',
  tests: './tests-agent/**/*.e2e.ts',
  agents: { default: { model: gateway(process.env.E2E_MODEL ?? 'openai/gpt-6-luna-fast') } },
};
