import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execute = promisify(execFile);

/** Executes public process tests through the installed-style built runner. */
async function fixture(body: string): Promise<{ code: number; output: string; report: string; artifacts: string[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-process-runner-'));
  try {
    const processTest = new URL('../../dist/test.js', import.meta.url).href;
    await writeFile(join(directory, 'e2e.config.ts'), `export default { modelPolicy: 'forbid', tests: ['*.e2e.ts'], targets: [{ name: 'process', platform: 'test' }], retries: 0, workers: 1 };\n`);
    await writeFile(join(directory, 'command.e2e.ts'), `import { test, expect } from ${JSON.stringify(processTest)};\n${body}\n`);
    const result = await execute(process.execPath, [fileURLToPath(new URL('../../../e2e/dist/cli/bin.js', import.meta.url)), 'run', '--no-model'], {
      cwd: directory, timeout: 10_000, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    }).then(({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }), (cause: unknown) => {
      const error = cause as Error & { code: number; stdout: string; stderr: string };
      return { code: error.code, output: error.stdout + error.stderr };
    });
    const output = join(directory, '.e2e');
    const artifacts: string[] = [];
    for (const relative of await readdir(output, { recursive: true })) {
      const file = join(output, relative);
      if ((await stat(file)).isFile()) artifacts.push(await readFile(file, 'utf8'));
    }
    return { ...result, report: await readFile(join(output, 'report.json'), 'utf8'), artifacts };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('the public process fixture fails a dropped nonzero command', async () => {
  const result = await fixture(`test('dropped failure', async ({ processes }) => {
    processes.run({ executable: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 1000 });
    await new Promise(resolve => setTimeout(resolve, 200));
  });`);
  expect(result.code, result.output).toBe(1);
  expect(result.report).toContain('Unobserved process operation failed');
  expect(JSON.parse(result.report).run.summary.failed).toBe(1);
});

test('the public process fixture preserves deliberately caught command failures', async () => {
  const result = await fixture(`test('expected failure', async ({ processes }) => {
    try {
      await processes.run({ executable: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 1000 });
      throw new Error('The expected exit failure was absent');
    } catch (error) { expect(error.code).toBe('PROCESS_EXIT_FAILED'); }
  });`);
  expect(result.code, result.output).toBe(0);
  expect(JSON.parse(result.report).run.summary.passed).toBe(1);
});

test('command steps attach bounded diagnostics without arguments, environment or output contents', async () => {
  const marker = 'PROCESS_REPORT_PRIVATE_VALUE';
  const result = await fixture(`test('recorded command', async ({ processes }) => {
    const result = await processes.run({ executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1]+process.env.REPORT_PRIVATE);process.stderr.write(process.argv[1])', '${marker}'],
      env: { REPORT_PRIVATE: '${marker}' }, timeoutMs: 1000,
    });
    expect(result.stdout.bytes.toString()).toBe('${marker}${marker}');
  });`);
  expect(result.code, result.output).toBe(0);
  const report = JSON.parse(result.report);
  const steps = report.run.results[0].attempts[0].steps;
  expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ api: 'processes.run', status: 'passed', label: 'Run process' })]));
  expect(steps.find((step: { api: string }) => step.api === 'processes.run').artifacts.length).toBe(1);
  const metadata = result.artifacts.map(content => { try { return JSON.parse(content); } catch { return undefined; } }).find(value => value?.schemaVersion === 1 && value.stdout !== undefined);
  expect(metadata).toMatchObject({ status: 'exited', exitCode: 0, stdout: { totalBytes: marker.length * 2, truncated: false }, stderr: { totalBytes: marker.length } });
  expect(result.output).not.toContain(marker);
  for (const content of result.artifacts) expect(content).not.toContain(marker);
});
