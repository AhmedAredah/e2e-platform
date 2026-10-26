/** Compiled CLI regressions: real config modules and separate worker processes. */
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createProject } from '../helpers/run-project.ts';

const STATIC = 'release-static-secret-N42x-7182';
const PROVIDER = 'release-provider-secret-J67p-9294';
const cli = fileURLToPath(new URL('../../dist/cli/bin.js', import.meta.url));

/** Captures successful and deliberately failing CLI runs alike. */
async function runCli(cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await promisify(execFile)(process.execPath, [cli, 'run', '--no-model'], { cwd, env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1' }, timeout: 20_000 });
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }
}

/** Reads final persisted evidence, excluding config and test source which intentionally hold fixtures. */
function evidence(root: string): string {
  return readdirSync(root).map((name) => {
    const entry = path.join(root, name);
    return statSync(entry).isDirectory() ? evidence(entry) : readFileSync(entry).toString();
  }).join('\n');
}

it('redacts config output, fragmented worker output, titles and thrown errors in the compiled CLI', async () => {
  const project = createProject({
    'e2e.config.ts': `console.log('config ${STATIC}'); export default { targets: [{ platform: 'desktop' }], secrets: { audit: '${STATIC}' }, workers: 2, artifacts: [], reporters: ['list'] };`,
    'tests/leak.e2e.ts': `import { test } from '@e2e-platform/core'; test('title ${STATIC}', async () => { process.stdout.write('${STATIC.slice(0, 11)}'); process.stdout.write('${STATIC.slice(11)}\\n'); process.stderr.write('${STATIC}\\n'); throw new Error('failure ${STATIC}'); });`,
  });
  try {
    const result = await runCli(project.dir);
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr + evidence(path.join(project.dir, '.e2e'))).not.toContain(STATIC);
    expect(result.stdout + result.stderr).toContain('<secret:audit>');
    const report = JSON.parse(readFileSync(path.join(project.dir, '.e2e', 'report.json'), 'utf8'));
    expect(report.run.results[0].titlePath.join(' ')).toContain('<secret:audit>');
  } finally { project.cleanup(); }
});

it('restores provider secret redaction and pixel taint across isolated session workers', async () => {
  const project = createProject({
    'e2e.config.ts': `import { defineEngine, LOCATOR_ACTION_KINDS } from '@e2e-platform/core/engine';
let echo = '';
const engine = defineEngine({ name: 'security-fixture', version: '1', spiVersion: 1, platform: 'desktop',
  async startAttempt() { echo = ''; },
  async observe() { return { root: { ref: { id: 'root', revision: '' }, role: 'window', children: [{ ref: { id: 'echo', revision: '' }, role: 'status', text: echo }] }, viewport: { width: 1, height: 1 }, pixels: { data: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1, scale: 1 }, maskedRegionCount: 0 }; },
  async locate() { return [{ ref: { id: 'field', revision: '' }, role: 'textbox' }]; }, actions: LOCATOR_ACTION_KINDS,
  async perform(_ref, action) { if (action.kind === 'fill') echo = action.value; },
  state: { async capture() { return { format: 'audit', version: 1, data: { echo } }; }, async restore(state) { echo = state.data.echo; console.log('restored ' + echo); } },
});
export default { targets: [{ engine }], secrets: { token: () => '${PROVIDER}' }, workers: 2, cache: 'off', artifacts: [], reporters: ['json'],
agents: { default: { executor: { name: 'audit', cache: 'off', async runStep(context) { const observation = await context.observe({ pixels: true }); if (observation.text.includes('${PROVIDER}') || observation.pixels !== undefined || observation.pixelsWithheld !== 'PIXEL_TAINTED') throw new Error('restored protection missing'); return { status: 'passed', summary: 'restored protection verified' }; } } } } };`,
    'tests/setup.e2e.ts': `import { test, secrets } from '@e2e-platform/core'; test.setup('seed', { sessions: ['member'] }, async ({ screen, session }) => { await screen.getByRole('textbox').fill(secrets.get('token')); await session.save('member'); });`,
    'tests/consumer.e2e.ts': `import { test } from '@e2e-platform/core'; test('consumer', { session: 'member' }, async ({ agent }) => { await agent.act('inspect restored state'); });`,
  });
  try {
    const result = await runCli(project.dir);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr + evidence(path.join(project.dir, '.e2e'))).not.toContain(PROVIDER);
    const report = JSON.parse(readFileSync(path.join(project.dir, '.e2e', 'report.json'), 'utf8'));
    expect(report.run.results.some((entry: { titlePath: string[]; status: string }) => entry.titlePath.includes('consumer') && entry.status === 'passed'), JSON.stringify(report.run.results)).toBe(true);
  } finally { project.cleanup(); }
});
