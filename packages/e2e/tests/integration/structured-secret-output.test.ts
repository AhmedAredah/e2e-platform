/** Protocol-like secret values must never change the verdict or wire grammar. */
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createProject, runProjectWithConfigFile } from '../helpers/run-project.ts';
import { assertValidReport } from '../helpers/report-schema.ts';
import type { RunEvent } from '../../src/run/events.ts';

const cli = fileURLToPath(new URL('../../dist/cli/bin.js', import.meta.url));

it.each(['failed', 'passed', 'ready', 'unit', 'type', 'status', 'file', 'ERROR', '1'])(
  'preserves failing verdicts and valid JSON with secret %s', async (secret) => {
    const project = createProject({
      'e2e.config.ts': `export default { targets: [{ name: 'target', platform: 'test' }], secrets: { token: ${JSON.stringify(secret)} }, artifacts: [], modelPolicy: 'forbid' };`,
      'tests/failure.e2e.ts': `import { test } from '@e2e-platform/core'; test('deliberate failure', async () => { throw new Error('failure fixture'); });`,
    });
    try {
      const result = await promisify(execFile)(process.execPath, [cli, 'run', '--no-model', '--reporter', 'json'], {
        cwd: project.dir, timeout: 15_000, env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1' },
      }).then((value) => ({ ...value, code: 0 }), (value: { stdout: string; stderr: string; code: number }) => value);
      expect(result.code, result.stderr).toBe(1);
      const stdout = JSON.parse(result.stdout);
      const stored = JSON.parse(readFileSync(path.join(project.dir, '.e2e/report.json'), 'utf8'));
      expect(stdout).toEqual(stored);
      assertValidReport(stored);
      expect(stored.run.status).toBe('failed');
      expect(stored.run.summary.failed).toBe(1);
      expect(stored.run.results[0].status).toBe('failed');
      expect(stored.run.results[0].attempts[0].error.code).toBe('ERROR');
    } finally { project.cleanup(); }
  },
);

it('redacts worker-resolved provider values from final user-derived identities', async () => {
  const value = 'provider-identity-secret-V91-5932';
  const project = createProject({
    'e2e.config.ts': `import { defineEngine } from '@e2e-platform/core/engine'; export default { artifacts: [], modelPolicy: 'forbid', secrets: { token: () => '${value}' }, targets: [{ name: 'native', platform: 'test', engine: defineEngine({ name: 'fixture', version: '1', spiVersion: 1, platform: 'test', actions: ['fill'], async observe() { return { root: { ref: { id: 'field', revision: '' }, role: 'textbox' }, viewport: { width: 20, height: 20 } }; }, async locate() { return [{ ref: { id: 'field', revision: '' }, role: 'textbox' }]; }, async perform() {} }) }] };`,
    'tests/provider.e2e.ts': `import { test, secrets } from '@e2e-platform/core'; test('case ${value}', async ({ screen }) => { await screen.getByRole('textbox').fill(secrets.get('token')); });`,
  });
  try {
    const result = await promisify(execFile)(process.execPath, [cli, 'run', '--no-model', '--reporter', 'json'], {
      cwd: project.dir, timeout: 15_000, env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1' },
    }).then((output) => ({ ...output, code: 0 }), (output: { stdout: string; stderr: string; code: number }) => output);
    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
    const { stdout } = result;
    const report = JSON.parse(stdout);
    assertValidReport(report);
    expect(stdout).not.toContain(value);
    expect(report.run.results[0].titlePath).toEqual(['case <secret:token>']);
    expect(report.run.results[0].testId).toMatch(/^redacted:/);
  } finally { project.cleanup(); }
});

it('preserves distinct confidential test identities and target references in reports', async () => {
  const first = 'identity-secret-Alpha-128';
  const second = 'identity-secret-Beta-927';
  const project = createProject({
    'e2e.config.ts': `export default { targets: [{ name: '${first}', platform: 'test' }], secrets: { first: '${first}', second: '${second}' }, artifacts: [], modelPolicy: 'forbid' };`,
    'tests/identity.e2e.ts': `import { test } from '@e2e-platform/core'; test('same ${first}', async()=>{}); test('same ${second}', async()=>{});`,
  });
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [cli, 'run', '--no-model', '--reporter', 'json'], {
      cwd: project.dir, timeout: 15_000, env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1' },
    });
    const report = JSON.parse(stdout);
    assertValidReport(report);
    expect(stdout).not.toContain(first);
    expect(stdout).not.toContain(second);
    expect(new Set(report.run.results.map((result: { testId: string }) => result.testId)).size).toBe(2);
    expect(report.run.results.every((result: { targetId: string }) => result.targetId === report.run.targets[0].id)).toBe(true);
  } finally { project.cleanup(); }
});

it('delivers each complete MCP response promptly after registering secrets', async () => {
  const value = 'mcp-secret-boundary-Q18-long-value';
  const project = createProject({
    'e2e.config.ts': `import { defineEngine } from '@e2e-platform/core/engine'; export default { secrets: { token: '${value}', digit: '1', word: 'text' }, targets: [{ name: 'test', platform: 'test', engine: defineEngine({ name: 'fixture', version: '1', spiVersion: 1, platform: 'test', async observe() { return { root: { ref: { id: 'node' }, role: 'button', name: '${value}' }, viewport: { width: 20, height: 20 } }; } }) }] };`,
  });
  const server = spawn(process.execPath, [cli, 'mcp', '--headless'], {
    cwd: project.dir, env: { ...process.env, CI: '', E2E_TELEMETRY_DISABLED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pending = '';
  let diagnostics = '';
  const waiters = new Map<number, (message: Record<string, unknown>) => void>();
  server.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); });
  server.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message['id'] === 'number') waiters.get(message['id'])?.(message);
    }
  });
  const request = (id: number, method: string, params?: unknown): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP response ${id} did not terminate: ${diagnostics}`)), 5_000);
    waiters.set(id, (message) => { clearTimeout(timer); waiters.delete(id); resolve(message); });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  try {
    const initialized = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'regression', version: '1' } });
    expect(initialized['id']).toBe(1);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const opened = await request(2, 'tools/call', { name: 'open_session', arguments: {} });
    expect(JSON.stringify(opened)).not.toContain(value);
    expect(opened).toMatchObject({ id: 2, result: { content: [{ type: 'text' }] } });
    expect((opened['result'] as { isError?: boolean }).isError).not.toBe(true);
    const listed = await request(3, 'tools/list');
    expect(listed).toMatchObject({ id: 3, result: { tools: expect.any(Array) } });
    await request(4, 'tools/call', { name: 'close_session', arguments: {} });
  } finally {
    if (server.exitCode === null) {
      const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()));
      server.kill('SIGTERM');
      await stopped;
    }
    project.cleanup();
  }
});

it('keeps buffered output ownership and withholds secrets split between test pairs', async () => {
  const value = 'Cross-owner-secret-D82-9763';
  const events: RunEvent[] = [];
  const { project, outcome } = await runProjectWithConfigFile({
    'tests/output.e2e.ts': `import { test } from '@e2e-platform/core';
      test('first', async () => { process.stdout.write('first ${value.slice(0, 12)}'); process.stderr.write('first stderr tail'); });
      test('second', async () => { process.stdout.write('${value.slice(12)} second'); });`,
  }, {
    appUrl: 'http://127.0.0.1:1',
    configSource: `export default { workers: 1, artifacts: [], modelPolicy: 'forbid', targets: [{ name: 'native', platform: 'test' }], secrets: { token: '${value}' } };`,
    runOptions: { onEvent: (event) => { events.push(event); } },
  });
  try {
    expect(outcome.status).toBe('passed');
    const started = events.filter((event) => event.type === 'test-started');
    expect(started).toHaveLength(2);
    const output = events.filter((event) => event.type === 'output');
    const first = output.filter((event) => event.pair?.testId === started[0]!.testId);
    expect(first.filter((event) => event.stream === 'stdout').map((event) => event.text).join('')).toBe('first ');
    expect(first.filter((event) => event.stream === 'stderr').map((event) => event.text).join('')).toBe('first stderr tail');
    expect(output.map((event) => event.text).join('')).not.toContain(value);
    expect(output.filter((event) => event.pair?.testId === started[1]!.testId).map((event) => event.text).join(''))
      .toBe(`${value.slice(12)} second`);
  } finally { project.cleanup(); }
});
