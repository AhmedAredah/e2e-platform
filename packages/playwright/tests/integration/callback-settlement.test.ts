/** Final browser callbacks belong to the attempt even when no later browser call observes them. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { run } from '@e2e-platform/core/runner';
import { playwright } from '../../src/engine.ts';
import { startFixtureApp } from '../helpers/fixture-app.ts';

test.each(['dialog', 'route'] as const)('public runner rejects a late %s callback failure after the final browser call', async (kind) => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-browser-callback-'));
  const app = await startFixtureApp();
  vi.stubEnv('E2E_TELEMETRY_DISABLED', '1');
  try {
    const testModule = new URL('../../dist/index.js', import.meta.url).href;
    const file = join(directory, 'callback.e2e.ts');
    const registration = kind === 'dialog'
      ? `await web.onDialog(async dialog => { await dialog.accept(); entered(); await new Promise(resolve => setTimeout(resolve, 50)); throw new Error('final dialog handler failed'); });`
      : `await web.route('**/last-request', async route => { await route.fulfill({ body: 'OK' }); entered(); await new Promise(resolve => setTimeout(resolve, 50)); throw new Error('final route handler failed'); });`;
    const trigger = kind === 'dialog'
      ? `await web.evaluate(() => { setTimeout(() => confirm('final dialog'), 0); });`
      : `await web.evaluate(() => { void fetch('/last-request').catch(() => undefined); });`;
    await writeFile(file, `import {test} from ${JSON.stringify(testModule)};
test('final callback', async ({app, web}) => {
  await app.open();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  ${registration}
  ${trigger}
  await started;
});\n`);
    const result = await run({ cwd: directory, files: [file], quiet: true, rawConfig: {
      tests: ['*.e2e.ts'], targets: [{ name: 'browser', engine: playwright({ url: app.url }) }],
      workers: 1, retries: 0, timeout: 5000, cleanupTimeout: 2000, cache: 'off', modelPolicy: 'forbid',
    } });
    expect(result.exitCode).not.toBe(0);
    expect(result.report.run.results).toHaveLength(1);
    expect(result.report.run.results[0]?.status).toBe('failed');
    expect(JSON.stringify(result.report.run.results)).toContain(`final ${kind} handler failed`);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
