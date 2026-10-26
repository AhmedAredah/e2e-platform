import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperationContext } from '@e2e-platform/core/engine';
import type { ProcessSession } from '@e2e-platform/process';
import { describe, expect, it, vi } from 'vitest';
import { NativeEngine, type NativeProcessLaunch } from '../src/index.ts';

const helper = fileURLToPath(new URL('./fixtures/mock-helper.mjs', import.meta.url));

class SidecarEngine extends NativeEngine {
  readonly launches: NativeProcessLaunch[] = [];
  readonly pids: number[] = [];
  constructor(private readonly sidecarArguments: readonly string[] = []) { super({ screenshots: false }); }
  protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
    this.launches.push(launch);
    const session = await super.createProcess({
      ...launch,
      options: { ...launch.options, executable: process.execPath, args: [helper, ...this.sidecarArguments] },
    });
    this.pids.push(session.pid);
    return session;
  }
}

async function withEngine(engine: NativeEngine, body: (context: OperationContext, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-sidecar-'));
  const signal = new AbortController().signal;
  const context: OperationContext = { signal, timeoutMs: 3000, runId: 'run', attemptId: 'attempt', origin: 'test' };
  try {
    await engine.init({ runId: 'run', targetName: 'sidecar', projectRoot: directory,
      app: { appPath: './application-without-helper', launchArguments: ['--test-profile'] },
      env: process.env, headed: false, workerSlot: 0, signal });
    await engine.startAttempt({ attemptId: 'attempt', artifactsDir: directory, signal, appLog: () => {}, environment: () => {} });
    await body(context, directory);
  } finally {
    await engine.stop({ signal, timeoutMs: 2000 });
    await rm(directory, { recursive: true, force: true });
  }
}

describe('owned native sidecar factory', () => {
  it('routes an application through a sidecar and preserves authentication, restart and cleanup', async () => {
    const engine = new SidecarEngine();
    await withEngine(engine, async (context, directory) => {
      await engine.launch(context);
      expect(engine.launches[0]?.options.executable).toBe(path.join(directory, 'application-without-helper'));
      expect(engine.launches[0]?.options.args).toEqual(['--test-profile']);
      expect(engine.launches[0]?.options.inheritEnv).toBe(false);
      expect((await engine.snapshot(context, false)).root.ref.id).toBe('root');
      await engine.perform({ id: 'name', revision: '' }, { kind: 'fill', value: 'Ada', sensitive: false }, context);
      await engine.perform({ id: 'submit', revision: '' }, { kind: 'tap' }, context);
      expect((await engine.snapshot(context, false)).root.children?.find((node) => node.testId === 'status')?.text).toBe('Hello Ada');
      const firstPid = engine.pids[0]!;
      await engine.launch(context);
      expect(() => process.kill(firstPid, 0)).toThrow();
      const tokens = engine.launches.map((launch) => launch.options.env?.E2E_NATIVE_TOKEN);
      expect(tokens.every((token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token))).toBe(true);
      expect(new Set(tokens).size).toBe(2);
      expect((await engine.snapshot(context, false)).root.children?.find((node) => node.testId === 'status')?.text).toBe('Ready');
    });
    for (const pid of engine.pids) expect(() => process.kill(pid, 0)).toThrow();
    await expect(engine.settle()).resolves.toBeUndefined();
  });

  it('drains a factory result returned after cancellation before teardown completes', async () => {
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquisition = new Promise<void>((resolve) => { acquired = resolve; });
    class LateEngine extends SidecarEngine {
      protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
        const session = await super.createProcess(launch);
        acquired();
        await gate;
        return session;
      }
    }
    const engine = new LateEngine();
    await withEngine(engine, async (context) => {
      const controller = new AbortController();
      const outcome = engine.launch({ ...context, signal: controller.signal }).then(() => undefined, (error: unknown) => error);
      await acquisition;
      controller.abort();
      let stopped = false;
      const teardown = engine.stop({ signal: context.signal, timeoutMs: 2000 }).then(() => { stopped = true; });
      await Promise.resolve();
      const factoryAborted = engine.launches[0]?.context.signal.aborted;
      const stoppedBeforeAcquisition = stopped;
      release();
      expect(await outcome).toMatchObject({ code: 'CANCELLED' });
      await teardown;
      expect(factoryAborted).toBe(true);
      expect(stoppedBeforeAcquisition).toBe(false);
      for (const pid of engine.pids) expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('stops a process acquired after its launch deadline', async () => {
    class ExpiredEngine extends SidecarEngine {
      protected override async createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
        const session = await super.createProcess(launch);
        await new Promise<void>((resolve) => setTimeout(resolve, launch.context.timeoutMs + 20));
        return session;
      }
    }
    const engine = new ExpiredEngine();
    await withEngine(engine, async (context) => {
      await expect(engine.launch({ ...context, timeoutMs: 30 })).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
      expect(engine.pids).toHaveLength(1);
      for (const pid of engine.pids) expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('retains sidecar crashes as attempt failures', async () => {
    const engine = new SidecarEngine(['--exit-on-perform']);
    await withEngine(engine, async (context) => {
      await engine.launch(context);
      await expect(engine.perform({ id: 'submit', revision: '' }, { kind: 'tap' }, context)).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
      await vi.waitFor(async () => { await expect(engine.settle()).rejects.toMatchObject({ code: 'ENGINE_FAILURE' }); });
    });
    for (const pid of engine.pids) expect(() => process.kill(pid, 0)).toThrow();
  });
});
