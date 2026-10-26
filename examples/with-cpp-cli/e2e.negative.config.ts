import config from './e2e.config.ts';

export default {
  ...config,
  tests: ['tests/planted-wrong-output.e2e.ts'],
};
