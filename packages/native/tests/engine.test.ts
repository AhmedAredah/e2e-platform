import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, fstatSync, openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type E2EConfig, type StepExecutor } from '@e2e-platform/core';
import { run } from '@e2e-platform/core/runner';
import type { RequestContext } from '../src/index.ts';
import { NativeEngine, NativeTransport, RpcNativeDriver, native } from '../src/index.ts';
import { describe, expect, it, vi } from 'vitest';
import type { OperationContext } from '@e2e-platform/core/engine';

const helper = fileURLToPath(new URL('./fixtures/mock-helper.mjs', import.meta.url));

async function scenario(body: string, args: readonly string[] = [], engine = native({ screenshots: false })) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-'));
  try {
    const sdkUrl = new URL('../../e2e/dist/index.js', import.meta.url).href;
    await writeFile(path.join(cwd, 'native.e2e.ts'), `import { test, expect } from ${JSON.stringify(sdkUrl)};
test('native scenario', async ({ app, screen }) => { ${body} });\n`);
    return await run({
      cwd, quiet: true, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' },
      rawConfig: {
        tests: '*.e2e.ts', targets: [{ name: 'mock', engine, app: { appPath: process.execPath, launchArguments: [helper, ...args] } }],
        actionTimeout: 1000, assertionTimeout: 100, retries: 0, cache: 'off', modelPolicy: 'forbid',
      } satisfies E2EConfig,
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('native engine through the real e2e-platform runner', () => {
  it('keeps the existing application alive when restart is already aborted', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-preabort-'));
    const engine = new NativeEngine({ screenshots: false });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, `--pid-file=${path.join(cwd, 'pid')}`] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      await engine.launch(context);
      const pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8'));
      await expect(engine.launch({ ...context, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect((await engine.snapshot(context, false)).root.ref.id).toBe('root');
    } finally { await engine.stop({ signal, timeoutMs: 2000 }); await rm(cwd, { recursive: true, force: true }); }
  });

  it('omits oversized logs as whole lines before the runner redacts registered secrets', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-long-log-'));
    const engine = new NativeEngine({ screenshots: false });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    const logs: string[] = [];
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, '--log-long-lines'] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: (entry) => { logs.push(entry.text); }, environment: () => {} });
      await engine.launch(context);
      await vi.waitFor(() => expect(logs).toHaveLength(2));
      expect(logs).toEqual(Array(2).fill('native output line omitted because it exceeds the size limit'));
      expect(logs.join('')).not.toContain('STRADDLING');
    } finally { await engine.stop({ signal, timeoutMs: 2000 }); await rm(cwd, { recursive: true, force: true }); }
  });

  it.each([false, true])('closes an acquired transport when driver construction fails (cleanup throws: %s)', async (cleanupThrows) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-constructor-'));
    const constructionError = new Error('driver constructor failed');
    const cleanupError = new Error('transport close failed');
    class OwnedTransport extends NativeTransport {
      readonly descriptor = openSync(path.join(cwd, 'owned-resource'), 'w');
      closed = false;
      async request(): Promise<unknown> { throw new Error('driver was not constructed'); }
      close(): void {
        if (this.closed) return;
        closeSync(this.descriptor);
        this.closed = true;
        if (cleanupThrows) throw cleanupError;
      }
    }
    let acquired: OwnedTransport | undefined;
    class FailingEngine extends NativeEngine {
      protected override async createTransport(): Promise<NativeTransport> { acquired = new OwnedTransport(); return acquired; }
      protected override createDriver(): RpcNativeDriver { throw constructionError; }
    }
    const engine = new FailingEngine({ screenshots: false });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, `--pid-file=${path.join(cwd, 'pid')}`] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      const outcome = await engine.launch(context).then(() => undefined, (error: unknown) => error);
      if (cleanupThrows) expect(outcome).toMatchObject({ errors: [constructionError, cleanupError] });
      else expect(outcome).toBe(constructionError);
      const resource = acquired;
      if (resource === undefined) throw new Error('transport was not acquired');
      expect(resource.closed).toBe(true);
      expect(() => fstatSync(resource.descriptor)).toThrow();
      const pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      try { acquired?.close(); } catch { /* The expected close error is asserted above. */ }
      await engine.stop({ signal, timeoutMs: 2000 });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('retains initialization and cleanup errors while stopping the acquired application', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-launch-errors-'));
    const initializationError = new Error('driver initialization failed');
    const cleanupError = new Error('driver close failed');
    class FailingDriver extends RpcNativeDriver {
      override async initialize(token: string, context: RequestContext): Promise<never> { await super.initialize(token, context); throw initializationError; }
      override close(): void { super.close(); throw cleanupError; }
    }
    class FailingEngine extends NativeEngine {
      protected override createDriver(transport: NativeTransport): RpcNativeDriver { return new FailingDriver(transport); }
    }
    const engine = new FailingEngine({ screenshots: false });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, `--pid-file=${path.join(cwd, 'pid')}`] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      await expect(engine.launch(context)).rejects.toMatchObject({ errors: [initializationError, { code: 'ENGINE_FAILURE', cause: { errors: [cleanupError] } }] });
      const pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await engine.stop({ signal, timeoutMs: 2000 }); await rm(cwd, { recursive: true, force: true }); }
  });

  it('rejects overlapping launches and cancels a pending acquisition before teardown returns', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-lifecycle-'));
    const controller = new NativeEngine({ screenshots: false, launchTimeout: 5000 });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 5000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    const cleanup = { signal, timeoutMs: 2000 };
    try {
      await controller.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, '--no-ready', `--pid-file=${path.join(cwd, 'pid')}`] }, env: process.env, headed: false, workerSlot: 0, signal });
      await controller.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      const first = controller.launch(context);
      // Attach before cancellation so a prompt rejection is always observed.
      const firstOutcome = first.then(() => 'passed', (error: unknown) => error);
      await expect(controller.launch(context)).rejects.toMatchObject({ code: 'INVALID_STATE' });
      let pid = 0;
      await vi.waitFor(async () => { pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8')); expect(pid).toBeGreaterThan(0); });
      await controller.stop(cleanup);
      expect(await firstOutcome).toMatchObject({ code: 'CANCELLED' });
      expect(() => process.kill(pid, 0)).toThrow();
      await controller.stop(cleanup);
    } finally { await controller.stop(cleanup); await rm(cwd, { recursive: true, force: true }); }
  });

  it('does not prove absence from a truncated native tree', async () => {
    const result = await scenario(`await app.open(); await expect(screen.getByTestId('status')).toHaveCount(0);`, ['--truncated']);
    expect(result.status).toBe('error');
    expect(result.report.run.results[0]?.attempts[0]?.status).toBe('failed');
    expect(JSON.stringify(result.report)).toContain('truncated');
  });

  it('stops the real helper even when a subclass close hook fails', async () => {
    class ThrowingDriver extends RpcNativeDriver {
      override close(): void { super.close(); throw new Error('extension close failed'); }
    }
    class ThrowingEngine extends NativeEngine {
      protected override createDriver(transport: NativeTransport) { return new ThrowingDriver(transport); }
    }
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-close-'));
    const engine = new ThrowingEngine({ screenshots: false });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, `--pid-file=${path.join(cwd, 'pid')}`] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      await engine.launch(context);
      const pid = Number(await readFile(path.join(cwd, 'pid'), 'utf8'));
      await expect(engine.stop({ signal: AbortSignal.abort(), timeoutMs: 1000 })).rejects.toThrow('cleanup failed');
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await engine.stop({ signal, timeoutMs: 1000 }); await rm(cwd, { recursive: true, force: true }); }
  });

  it('launches an authenticated helper, drives locators and records deterministic assertions', async () => {
    const result = await scenario(`
      await app.open();
      await screen.getByTestId('name').fill('Ada');
      await screen.getByRole('button', 'Greet').click();
      await expect(screen.getByTestId('status')).toHaveText('Hello Ada');
      await app.restart();
      await expect(screen.getByTestId('status')).toHaveText('Ready');
    `);
    expect(result.status, JSON.stringify(result.report)).toBe('passed');
    const steps = result.report.run.results[0]?.attempts[0]?.steps ?? [];
    expect(steps.filter((step) => step.kind === 'assertion')).toHaveLength(2);
    expect(steps.every((step) => step.status === 'passed')).toBe(true);
  });

  it('fails a planted wrong result instead of accepting a successful click', async () => {
    const result = await scenario(`
      await app.open();
      await screen.getByTestId('name').fill('Ada');
      await screen.getByTestId('submit').click();
      await expect(screen.getByTestId('status')).toHaveText('Hello Ada');
    `, ['--bug']);
    expect(result.status).toBe('failed');
    expect(result.exitCode).not.toBe(0);
    expect(result.report.run.results[0]?.attempts[0]?.steps.some((step) => step.kind === 'assertion' && step.status === 'failed' && step.error?.category === 'test')).toBe(true);
  });

  it('checks negotiated actions before accepting launch', async () => {
    const result = await scenario('await app.open();', ['--missing-action']);
    expect(result.status).toBe('error');
    expect(JSON.stringify(result.report)).toContain('UNSUPPORTED_CAPABILITY');
  });

  it('fails the report when an unsolicited frame follows the final successful action', async () => {
    let disconnected = false;
    class ObservedEngine extends NativeEngine {
      protected override async createTransport(port: number, context: RequestContext): Promise<NativeTransport> {
        const transport = await super.createTransport(port, context);
        transport.onDisconnect(() => { disconnected = true; });
        return transport;
      }
    }
    const result = await scenario(`await app.open(); await screen.getByTestId('submit').click();`, ['--extra-reply'], new ObservedEngine({ screenshots: false }).handle());
    expect(disconnected).toBe(true);
    expect(JSON.stringify(result.report)).toContain('bridge disconnected');
    expect(result.status).toBe('error');
    expect(result.report.run.results[0]?.attempts[0]?.status).toBe('failed');
    expect(result.exitCode).not.toBe(0);
  });

  it('bounds readiness and retains a crash even if the test restarts the app', async () => {
    const unready = await scenario('await app.open();', ['--no-ready'], native({ screenshots: false, launchTimeout: 100 }));
    expect(unready.status).toBe('failed');
    expect(JSON.stringify(unready.report)).toContain('ACTION_FAILED');
    expect(JSON.stringify(unready.report)).toContain('operation timed out');
    const crashed = await scenario(`
      await app.open();
      await screen.getByTestId('submit').click().catch(() => {});
      await app.restart();
    `, ['--exit-on-perform']);
    expect(crashed.status).toBe('error');
    expect(crashed.report.run.results[0]?.attempts[0]?.status).toBe('failed');
    expect(JSON.stringify(crashed.report)).toContain('exited unexpectedly');
  });

  it('rejects source secret leakage and uncertain disconnected mutations', async () => {
    const leaking = await scenario(`await app.open(); await expect(screen.getByTestId('status')).toHaveText('Ready');`, ['--secure-leak']);
    expect(leaking.status).toBe('error');
    expect(JSON.stringify(leaking.report)).toContain('ENGINE_FAILURE');
    expect(JSON.stringify(leaking.report)).not.toContain('must-not-escape');
    const disconnected = await scenario(`await app.open(); await screen.getByTestId('submit').click();`, ['--disconnect-perform']);
    expect(disconnected.status).toBe('failed');
    expect(JSON.stringify(disconnected.report)).toContain('ACTION_FAILED');
    expect(JSON.stringify(disconnected.report)).toContain('disconnected after dispatch');
    expect(JSON.stringify(disconnected.report)).toContain('bridge disconnected');
  });

  it('honors a subclassed driver through the standard engine lifecycle', async () => {
    let snapshots = 0;
    class ProjectDriver extends RpcNativeDriver {
      override async snapshot(context: RequestContext, pixels: boolean, observed = true) {
        snapshots++;
        return super.snapshot(context, pixels, observed);
      }
    }
    class ProjectEngine extends NativeEngine {
      protected override createDriver(transport: NativeTransport) { return new ProjectDriver(transport); }
    }
    const result = await scenario(`await app.open(); await expect(screen.getByTestId('status')).toHaveText('Ready');`, [], new ProjectEngine({ screenshots: false }).handle());
    expect(result.status).toBe('passed');
    expect(snapshots).toBeGreaterThan(0);
  });

  it('records a verified scripted agent step and replays it without calling the executor', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-replay-'));
    const sdkUrl = new URL('../../e2e/dist/index.js', import.meta.url).href;
    let executions = 0;
    const executor: StepExecutor = {
      name: 'native-scripted', version: '1',
      async runStep(context) {
        executions++;
        await context.observe();
        await context.actions.type({ id: 'name' }, 'Ada');
        await context.actions.tap({ id: 'submit' });
        return { status: 'passed', summary: 'greeted Ada' };
      },
    };
    vi.stubEnv('E2E_TELEMETRY_DISABLED', '1');
    try {
      await writeFile(path.join(cwd, 'greet.e2e.ts'), `import { test, expect } from ${JSON.stringify(sdkUrl)};
test('cached native greeting', async ({ app, agent, screen }) => {
  await app.open();
  await agent.act('greet Ada');
  await expect(screen.getByTestId('status')).toHaveText('Hello Ada');
});\n`);
      const config: E2EConfig = {
        targets: [{ name: 'mock', engine: native({ screenshots: false }), app: { appPath: process.execPath, launchArguments: [helper] } }],
        tests: '*.e2e.ts', cache: 'read-write',
        agents: { default: { executor } },
      };
      const first = await run({ cwd, rawConfig: config, quiet: true });
      expect(first.status, JSON.stringify(first.report.run.errors)).toBe('passed');
      expect(executions).toBe(1);
      const second = await run({ cwd, rawConfig: { ...config, modelPolicy: 'forbid' }, quiet: true });
      expect(second.status, JSON.stringify(second.report.run.errors)).toBe('passed');
      expect(executions).toBe(1);
      expect(second.report.run.results[0]?.attempts[0]?.steps.some((step) => step.cache?.mode === 'self-finalized')).toBe(true);
      const original = await readFile(path.join(cwd, 'greet.e2e.ts'), 'utf8');
      await writeFile(path.join(cwd, 'greet.e2e.ts'), original.replace("agent.act('greet Ada')", "agent.act('a new unrecorded greeting')"));
      const missing = await run({ cwd, rawConfig: { ...config, agents: { default: { model: false } }, modelPolicy: 'forbid' }, quiet: true });
      expect(missing.status).toBe('blocked');
      expect(executions).toBe(1);
    } finally { vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); }
  });
});
