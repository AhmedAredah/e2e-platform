import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type E2EConfig } from '@e2e-platform/core';
import { run } from '@e2e-platform/core/runner';
import { describe, expect, it, vi } from 'vitest';
import { desktop } from '../src/index.ts';

const interpreter = process.env.E2E_TEST_PYTHON;
const fixture = fileURLToPath(new URL('./fixtures/fake-atspi-host.py', import.meta.url));
const target = fileURLToPath(new URL('./fixtures/desktop-target.mjs', import.meta.url));

// Opt in explicitly; ordinary JavaScript consumers do not need a Python runtime.
describe.skipIf(process.platform !== 'linux' || interpreter === undefined)('runner against the Python sidecar protocol with an injected provider', () => {
  it.each([false, true])('checks semantic results and owned application cleanup (planted defect: %s)', async (bug) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop protocol & runner '));
    try {
      const sdkUrl = new URL('../../e2e/dist/index.js', import.meta.url).href;
      await writeFile(path.join(directory, 'desktop.e2e.ts'), `import { test, expect } from ${JSON.stringify(sdkUrl)};
test('greet through the Python desktop protocol', async ({ app, screen }) => {
  await app.open();
  await screen.getByRole('textbox', 'Name').fill('Ada');
  await screen.getByRole('button', 'Greet').click();
  await expect(screen.getByTestId('status')).toHaveText('Hello Ada');
});\n`);
      const result = await run({
        cwd: directory, quiet: true,
        env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', E2E_FAKE_BUG: bug ? '1' : '0', E2E_FAKE_TARGET_RECORD: path.join(directory, 'target.json') },
        rawConfig: {
          tests: '*.e2e.ts',
          targets: [{
            name: 'python-protocol',
            engine: desktop({ backend: 'linux-atspi', executable: interpreter!, args: [fixture] }),
            app: { appPath: process.execPath, launchArguments: [target, path.join(directory, 'target.json')] },
          }],
          actionTimeout: 3000, assertionTimeout: 100, retries: 0, cache: 'off', modelPolicy: 'forbid',
        } satisfies E2EConfig,
      });
      expect(result.status, JSON.stringify(result.report)).toBe(bug ? 'failed' : 'passed');
      expect(result.exitCode).toBe(bug ? 1 : 0);
      const attempts = result.report.run.results[0]?.attempts ?? [];
      expect(attempts).toHaveLength(1);
      if (bug) expect(attempts[0]?.steps.some((step) => step.kind === 'assertion' && step.status === 'failed' && step.error?.code === 'ASSERTION_FAILED')).toBe(true);
      const record = JSON.parse(await readFile(path.join(directory, 'target.json'), 'utf8')) as { pid: number; nativeToken?: string };
      expect(record.nativeToken).toBeUndefined();
      await vi.waitFor(() => expect(() => process.kill(record.pid, 0)).toThrow());
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
