import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineError, type OperationContext } from '@e2e-platform/core/engine';
import { run } from '@e2e-platform/core/runner';
import { expect, it, vi } from 'vitest';
import { NativeEngine, NativeTransport, RpcNativeDriver } from '../src/index.ts';
import { NativeActionability } from '../src/engine/actionability.ts';
import { NativeActionTimeline } from '../src/engine/action-timeline.ts';

const helper = fileURLToPath(new URL('./fixtures/mock-helper.mjs', import.meta.url));
const signal = new AbortController().signal;
const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
const button = { id: 'submit', revision: '' };

async function withEngine(args: readonly string[], body: (engine: NativeEngine, directory: string) => Promise<void>, isolateProfile = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-workflows-'));
  const engine = new NativeEngine({ screenshots: false, isolateProfile });
  try {
    await engine.init({ runId: 'run', targetName: 'native', projectRoot: directory, app: { appPath: process.execPath, launchArguments: [helper, `--record-requests=${path.join(directory, 'requests')}`, `--profile-file=${path.join(directory, 'profile.json')}`, ...args] }, env: process.env, headed: false, workerSlot: 0, signal });
    await engine.startAttempt({ attemptId: 'attempt', artifactsDir: directory, signal, appLog: () => {}, environment: () => {} });
    await engine.launch(context);
    await body(engine, directory);
  } finally { await engine.stop({ signal, timeoutMs: 2000 }); await rm(directory, { recursive: true, force: true }); }
}

async function methods(directory: string): Promise<string[]> {
  return (await readFile(path.join(directory, 'requests'), 'utf8')).trim().split('\n');
}

it('waits through read-only preflight and dispatches input exactly once', async () => {
  await withEngine(['--preflight-delay=175'], async (engine, directory) => {
    await engine.perform(button, { kind: 'tap' }, context);
    const requests = await methods(directory);
    expect(requests.filter((method) => method === 'actionability').length).toBeGreaterThan(1);
    expect(requests.filter((method) => method === 'perform')).toHaveLength(1);
  });
});

it('does not dispatch while the target never becomes ready', async () => {
  await withEngine(['--preflight-delay=60000'], async (engine, directory) => {
    const outcome = await engine.perform(button, { kind: 'tap' }, { ...context, timeoutMs: 80 }).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(EngineError);
    expect(['NOT_ACTIONABLE', 'OPERATION_TIMEOUT']).toContain((outcome as EngineError).code);
    expect(await methods(directory)).not.toContain('perform');
  });
});

it('cancels readiness polling without dispatching input', async () => {
  await withEngine(['--preflight-delay=60000'], async (engine, directory) => {
    const controller = new AbortController();
    const pending = engine.perform(button, { kind: 'tap' }, { ...context, signal: controller.signal });
    const outcome = pending.catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 35));
    controller.abort();
    expect(await outcome).toMatchObject({ code: 'CANCELLED' });
    expect(await methods(directory)).not.toContain('perform');
  });
});

it('rejects malformed preflight acknowledgements without dispatching input', async () => {
  await withEngine(['--preflight-delay=0', '--malformed-preflight'], async (engine, directory) => {
    await expect(engine.perform(button, { kind: 'tap' }, context)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect(await methods(directory)).not.toContain('perform');
  });
});

it('never repeats a mutation that disconnects after a successful preflight', async () => {
  await withEngine(['--preflight-delay=0', '--disconnect-perform'], async (engine, directory) => {
    await expect(engine.perform(button, { kind: 'tap' }, context)).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    expect((await methods(directory)).filter((method) => method === 'perform')).toHaveLength(1);
  });
});

it('keeps legacy helpers compatible without probing an undeclared preflight', async () => {
  await withEngine([], async (engine, directory) => {
    await engine.perform(button, { kind: 'tap' }, context);
    expect(await methods(directory)).not.toContain('actionability');
    await expect(engine.windows(context)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(await methods(directory)).not.toContain('windows');
  });
});

it('enumerates and activates owned windows with a new snapshot root', async () => {
  await withEngine(['--windows'], async (engine, directory) => {
    expect((await engine.snapshot(context, false)).root.ref.id).toBe('window-1');
    expect(await engine.windows(context)).toEqual([
      { id: 'window-1', title: 'Editor', active: true, visible: true, modal: false },
      { id: 'window-2', title: 'Settings', active: false, visible: true, modal: false },
    ]);
    await engine.activateWindow('window-2', context);
    expect((await engine.snapshot(context, false)).root.ref.id).toBe('window-2');
    expect((await engine.windows(context)).find((window) => window.id === 'window-2')?.active).toBe(true);
    expect((await methods(directory)).filter((method) => method === 'window.activate')).toHaveLength(1);
  });
});

it('owns a fresh profile per attempt, preserves it across restart and removes it at teardown', async () => {
  await withEngine([], async (engine, directory) => {
    const first = engine.profileDirectory;
    expect(first).toBeTypeOf('string');
    const env = JSON.parse(await readFile(path.join(directory, 'profile.json'), 'utf8')) as Record<string, string>;
    expect(env.profile).toBe(first);
    expect(env.config).toBe(path.join(first!, 'config'));
    await writeFile(path.join(first!, 'settings.json'), '{"saved":true}');
    await engine.launch(context);
    expect(engine.profileDirectory).toBe(first);
    expect(await readFile(path.join(first!, 'settings.json'), 'utf8')).toContain('saved');
    await engine.stop({ signal, timeoutMs: 2000 });
    await expect(stat(first!)).rejects.toMatchObject({ code: 'ENOENT' });
    await engine.startAttempt({ attemptId: 'next', artifactsDir: directory, signal, appLog: () => {}, environment: () => {} });
    expect(engine.profileDirectory).not.toBe(first);
    expect(engine.profileDirectory).toBeTypeOf('string');
  }, true);
});

it.each([false, true])('accepts application-driven root changes only with negotiated windows (declared: %s)', async (declared) => {
  await withEngine(['--changing-root', ...(declared ? ['--windows'] : [])], async (engine, directory) => {
    expect((await engine.snapshot(context, false)).root.ref.id).toBe('window-1');
    await engine.perform(button, { kind: 'tap' }, context);
    if (declared) expect((await engine.snapshot(context, false)).root.ref.id).toBe('window-2');
    else await expect(engine.snapshot(context, false)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect((await methods(directory)).filter((method) => method === 'perform')).toHaveLength(1);
  });
});

it('publishes a bounded timeline without values, keys, node ids or application errors', async () => {
  await withEngine([], async (engine, directory) => {
    const secret = 'private-profile-text-294';
    await engine.perform({ id: 'name', revision: '' }, { kind: 'fill', value: secret, sensitive: true }, context);
    await engine.press('Control+V', context);
    const relative = await engine.writeTimeline();
    const text = await readFile(path.join(directory, relative), 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Control+V');
    const parsed = JSON.parse(text) as { entries: { operation: string; action?: string }[] };
    expect(parsed.entries.map((entry) => entry.operation)).toEqual(['restart', 'perform', 'keyboard.press']);
    expect(parsed.entries[1]?.action).toBe('fill');
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-timeline-'));
  try {
    const timeline = new NativeActionTimeline();
    for (let index = 0; index < 1002; index++) await timeline.record('perform', 'tap', async () => {});
    const relative = await timeline.write(directory);
    const parsed = JSON.parse(await readFile(path.join(directory, relative), 'utf8')) as { omitted: number; entries: unknown[] };
    expect(parsed.entries).toHaveLength(1000);
    expect(parsed.omitted).toBe(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('propagates stale preflight failures for the runner to re-resolve instead of repeating them', async () => {
  let requests = 0;
  class StaleTransport extends NativeTransport {
    async request() { requests++; throw new EngineError('NODE_STALE', 'old ref', { retryable: true }); }
    close() {}
  }
  await expect(new NativeActionability().wait(new RpcNativeDriver(new StaleTransport()), button, { kind: 'tap' }, context)).rejects.toMatchObject({ code: 'NODE_STALE' });
  expect(requests).toBe(1);
});

it('exposes the typed native fixture and attaches a sanitized timeline through the real runner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-fixture-'));
  try {
    const publicEntry = new URL('../dist/test.js', import.meta.url).href;
    await writeFile(path.join(directory, 'windows.e2e.ts'), `import { test, expect } from ${JSON.stringify(publicEntry)};
test.afterEach(async ({ native }) => { await native.attachTimeline(); });
test('switches windows', async ({ app, native, screen }) => {
  await app.open();
  expect(native.profileDirectory).toBeDefined();
  const windows = await native.windows();
  expect(windows.length).toBe(2);
  await native.activateWindow(windows[1]!.id);
  await expect.poll(async () => (await native.windows()).find(window => window.id === windows[1]!.id)?.active).toBe(true);
  await screen.getByTestId('name').fill('private-user-text-486');
});\n`);
    const result = await run({ cwd: directory, quiet: true, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' }, rawConfig: {
      tests: '*.e2e.ts', targets: [{ name: 'mock', engine: new NativeEngine({ screenshots: false, isolateProfile: true }).handle(), app: { appPath: process.execPath, launchArguments: [helper, '--windows'] } }],
      actionTimeout: 1000, assertionTimeout: 500, retries: 0, cache: 'off', modelPolicy: 'forbid',
    } });
    expect(result.status, JSON.stringify(result.report)).toBe('passed');
    const attempt = result.report.run.results[0]?.attempts[0];
    const artifact = attempt?.artifacts.find((item) => item.path?.endsWith('native/actions.json'));
    expect(artifact).toBeDefined();
    const text = await readFile(path.join(directory, '.e2e/artifacts', artifact!.path!), 'utf8');
    expect(text).toContain('window.activate');
    expect(text).not.toContain('private-user-text-486');
    expect(text).not.toContain('window-2');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('classifies expiration after a read-only not-ready response deterministically', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(100).mockReturnValue(200);
  class UnreadyTransport extends NativeTransport {
    override async request(): Promise<unknown> { throw new EngineError('NOT_ACTIONABLE', 'pending', { retryable: false }); }
    override close(): void {}
  }
  try {
    await expect(new NativeActionability().wait(new RpcNativeDriver(new UnreadyTransport()), button, { kind: 'tap' }, { signal, timeoutMs: 50 })).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
  } finally { now.mockRestore(); }
});
