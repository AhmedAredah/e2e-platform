import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, fstatSync, openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type E2EConfig, type StepExecutor } from '@e2e-platform/core';
import type { ProcessResult, ProcessSession } from '@e2e-platform/process';
import { run } from '@e2e-platform/core/runner';
import type { RequestContext } from '../src/index.ts';
import { NativeEngine, NativeTransport, RpcNativeDriver, native, type NativeProcessLaunch } from '../src/index.ts';
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
  it('retains an isolated profile and process ownership until a failed stop is recovered', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'e2e-retained-profile-'));
    let profile = '';
    let pid: number | undefined;
    let stops = 0;
    class RecoverableEngine extends NativeEngine {
      protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
        profile = launch.options.env?.['E2E_NATIVE_PROFILE_DIR'] ?? '';
        const child = await super.createProcess(launch); pid = child.pid;
        return { ...child, get stdout() { return child.stdout; }, get stderr() { return child.stderr; },
          async stop() { if (++stops === 1) throw new Error('stop unavailable'); return child.stop(); },
        };
      }
    }
    const engine = new RecoverableEngine({ screenshots: false, isolateProfile: true });
    const signal = new AbortController().signal;
    const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
    try {
      await engine.init({ runId: 'run', targetName: 'mock', projectRoot: cwd, app: { appPath: process.execPath, launchArguments: [helper, '--ignore-shutdown'] }, env: process.env, headed: false, workerSlot: 0, signal });
      await engine.startAttempt({ attemptId: 'attempt', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} });
      await engine.launch(context);
      await expect(engine.stop(context)).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
      expect(profile).not.toBe(''); await access(profile);
      expect(pid).toBeGreaterThan(0); expect(() => process.kill(pid!, 0)).not.toThrow();
      await expect(engine.startAttempt({ attemptId: 'next', artifactsDir: cwd, signal, appLog: () => {}, environment: () => {} })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await engine.stop(context);
      expect(stops).toBe(2); await expect(access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally { await engine.stop(context); await rm(cwd, { recursive: true, force: true }); }
  });

  it('includes labels in positive and negated polling assertion failures', async () => {
    // This tests real cross-process reporting, not a 100 ms scheduling bound.
    // Exact deadline and early-timeout behavior use controlled clocks separately.
    for (const assertion of ['toHaveText("wrong", { timeout: 1000 })', 'not.toHaveText("Ready", { timeout: 1000 })']) {
      const result = await scenario(`await app.open(); await expect(screen.getByTestId('status')).toHaveText('Ready', { timeout: 5000 }); await expect(screen.getByTestId('status'), '[oracle:calculation]').${assertion};`);
      expect(result.report.run.results[0]?.attempts[0]?.error).toMatchObject({
        code: 'ASSERTION_FAILED', message: expect.stringContaining('[oracle:calculation]'),
      });
      expect(result.report.run.results[0]?.attempts[0]?.error?.message).toContain('observed: text "Ready"');
    }
  });

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
      failed = false;
      override close(): void { super.close(); if (!this.failed) { this.failed = true; throw cleanupError; } }
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

  it.each([['ECONNRESET', 'ECONNRESET'], ['private-code', 'unclassified']])('stops the real helper and sanitizes a subclass cleanup code (%s)', async (code, diagnostic) => {
    class ThrowingDriver extends RpcNativeDriver {
      failed = false;
      override close(): void { super.close(); if (!this.failed) { this.failed = true; throw Object.assign(new Error('private-error-message'), { code }); } }
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
      const failure = await engine.stop({ signal: AbortSignal.abort(), timeoutMs: 1000 }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'ENGINE_FAILURE', message: `native application cleanup failed (driver-close:${diagnostic})` });
      expect(String(failure)).not.toContain('private-');
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

  it('bounds readiness and retains a disconnected bridge even if the test immediately restarts the app', async () => {
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
    // TCP close can precede the process exit event. An immediate restart may
    // request supervised termination first, but cannot erase the bridge fault.
    expect(crashed.report.run.results[0]?.attempts[0]?.error).toMatchObject({
      category: 'infrastructure', code: 'ENGINE_FAILURE', phase: 'afterEach',
      message: expect.stringMatching(/^native (bridge disconnected unexpectedly|application exited unexpectedly)/),
    });
  });

  it('retains a confirmed natural crash after the application restarts', async () => {
    const exits: ProcessResult[] = [];
    class ConfirmedExitEngine extends NativeEngine {
      private previousResult: Promise<ProcessResult> | undefined;
      protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
        const child = await super.createProcess(launch);
        this.previousResult = child.result;
        return child;
      }
      override async launch(context: OperationContext): Promise<void> {
        // Synchronize on real process completion instead of racing TCP close
        // against restart's stop request or relying on an arbitrary delay.
        if (this.previousResult !== undefined) exits.push(await this.previousResult);
        await super.launch(context);
      }
    }
    const result = await scenario(`
      await app.open();
      await screen.getByTestId('submit').click().catch(() => {});
      await app.restart();
    `, ['--exit-on-perform'], new ConfirmedExitEngine({ screenshots: false }).handle());
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ status: 'exited', exitCode: 22 });
    expect(result.status, JSON.stringify(result.report)).toBe('error');
    expect(result.report.run.results[0]?.attempts[0]?.status).toBe('failed');
    expect(JSON.stringify(result.report)).toContain('exited unexpectedly');
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

  it('does not reinterpret supervised nonzero termination as a second application crash', async () => {
    const terminations: ProcessResult[] = [];
    class NonzeroTerminationEngine extends NativeEngine {
      protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
        const child = await super.createProcess(launch);
        // Windows taskkill reports a nonzero exit code for an intentional stop.
        // Reproduce that contract on every host while retaining the real process,
        // TCP disconnection, attempt cancellation, and awaited cleanup lifecycle.
        const result = child.result.then((completion) => {
          if (completion.status !== 'aborted' && completion.status !== 'stopped') return completion;
          const terminated = { ...completion, exitCode: 1, signal: null };
          terminations.push(terminated);
          return terminated;
        });
        return { ...child, result,
          get stdout() { return child.stdout; }, get stderr() { return child.stderr; },
          async stop() { await child.stop(); return result; },
        };
      }
    }
    const result = await scenario('await app.open(); await screen.getByTestId("submit").click();',
      ['--disconnect-perform'], new NonzeroTerminationEngine({ screenshots: false }).handle());
    expect(terminations).toHaveLength(1);
    expect(result.status, JSON.stringify(result.report)).toBe('failed');
    const attempt = result.report.run.results[0]?.attempts[0];
    expect(attempt?.error?.code).toBe('ACTION_FAILED');
    expect(attempt?.cleanup).toBe('complete');
    expect(JSON.stringify(result.report)).toContain('disconnected after dispatch');
    expect(JSON.stringify(result.report)).toContain('bridge disconnected');
    expect(JSON.stringify(result.report)).not.toContain('exited unexpectedly');
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
