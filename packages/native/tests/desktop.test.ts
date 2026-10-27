import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineInitInfo, OperationContext } from '@e2e-platform/core/engine';
import { describe, expect, it, vi } from 'vitest';
import { desktop, DesktopEngine, type DesktopBackend, type DesktopOptions } from '../src/index.ts';

const sidecar = fileURLToPath(new URL('./fixtures/mock-desktop-sidecar.mjs', import.meta.url));
const target = fileURLToPath(new URL('./fixtures/desktop-target.mjs', import.meta.url));
const backend: DesktopBackend = process.platform === 'win32' ? 'windows-uia' : process.platform === 'darwin' ? 'macos-ax' : 'linux-atspi';
const signal = new AbortController().signal;
const context: OperationContext = { signal, timeoutMs: 5000, runId: 'run', attemptId: 'attempt', origin: 'test' };

/** Exercise the public desktop class with actual subprocesses and protocol transport. */
async function withDesktop(
  args: readonly string[],
  body: (engine: DesktopEngine, directory: string, info: EngineInitInfo) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop consumer & tests '));
  const driverArgs = [sidecar, `--record=${path.join(directory, 'driver.json')}`, ...args];
  const options: DesktopOptions = { backend, executable: process.execPath, args: driverArgs };
  const engine = new DesktopEngine(options);
  driverArgs.push('--missing-action');
  const info: EngineInitInfo = {
    runId: 'run', targetName: 'desktop', projectRoot: directory,
    app: { appPath: process.execPath, launchArguments: [target, path.join(directory, 'target.json'), 'spaces and "quotes"', '; literal $(command)', '--'] },
    env: { DESKTOP_TEST_ALLOWED: 'yes', ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }) },
    headed: true, workerSlot: 0, signal,
  };
  try {
    await engine.init(info);
    await engine.startAttempt({ attemptId: 'attempt', artifactsDir: directory, signal, appLog: () => {}, environment: () => {} });
    await body(engine, directory, info);
  } finally {
    await engine.stop({ signal, timeoutMs: 2000 });
    await rm(directory, { recursive: true, force: true });
  }
}

/** Wait for the independently spawned target to record its received argv. */
async function targetRecord(directory: string): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {};
  await vi.waitFor(async () => { result = JSON.parse(await readFile(path.join(directory, 'target.json'), 'utf8')) as Record<string, unknown>; expect(result.pid).toBeGreaterThan(0); });
  return result;
}

/** A stopped process must no longer be present, including the sidecar-owned application. */
async function expectGone(pid: number): Promise<void> {
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
}

describe('desktop accessibility sidecar integration', () => {
  it('starts a real sidecar and target with literal argv, negotiated semantics and isolated environment', async () => {
    vi.stubEnv('DESKTOP_TEST_AMBIENT', 'must-not-inherit');
    try {
      await withDesktop([], async (engine, directory, info) => {
        await engine.launch(context);
        const driver = JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')) as { sidecarPid: number; appPid: number; command: string; args: string[]; cwd: string; tokenPresent: boolean };
        expect(driver).toMatchObject({ command: process.execPath, args: info.app.launchArguments, tokenPresent: true });
        expect(await realpath(driver.cwd)).toBe(await realpath(directory));
        expect(await targetRecord(directory)).toEqual({ pid: driver.appPid, args: ['spaces and "quotes"', '; literal $(command)', '--'], allowed: 'yes' });
        expect((await engine.snapshot(context, false)).root.name).toBe('Mock desktop');
        await engine.stop({ signal, timeoutMs: 2000 });
        await expectGone(driver.appPid);
        await expectGone(driver.sidecarPid);
        await expect(engine.settle()).resolves.toBeUndefined();
      });
    } finally { vi.unstubAllEnvs(); }
  });

  it('restarts an owned application and stops both the old target and sidecar', async () => {
    await withDesktop([], async (engine, directory) => {
      await engine.launch(context);
      const first = JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')) as { sidecarPid: number; appPid: number };
      await targetRecord(directory);
      await engine.launch(context);
      const second = JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')) as { sidecarPid: number; appPid: number };
      expect(second.sidecarPid).not.toBe(first.sidecarPid);
      expect(second.appPid).not.toBe(first.appPid);
      await expectGone(first.appPid);
      await expectGone(first.sidecarPid);
    });
  });

  it('cleans up both processes when negotiated capabilities are incomplete', async () => {
    await withDesktop(['--missing-action'], async (engine, directory) => {
      await expect(engine.launch(context)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
      const driver = JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')) as { sidecarPid: number; appPid: number };
      await expectGone(driver.appPid);
      await expectGone(driver.sidecarPid);
    });
  });

  it('cancels an unready driver and waits for its owned application to stop', async () => {
    await withDesktop(['--no-ready'], async (engine, directory) => {
      const controller = new AbortController();
      const outcome = engine.launch({ ...context, signal: controller.signal }).catch((error: unknown) => error);
      await targetRecord(directory);
      const driver = JSON.parse(await readFile(path.join(directory, 'driver.json'), 'utf8')) as { sidecarPid: number; appPid: number };
      controller.abort();
      await expect(outcome).resolves.toMatchObject({ code: 'CANCELLED' });
      await expectGone(driver.appPid);
      await expectGone(driver.sidecarPid);
    });
  });

  it('refuses a mismatched OS before launching a driver', async () => {
    const other = backend === 'windows-uia' ? 'linux-atspi' : 'windows-uia';
    const engine = new DesktopEngine({ backend: other, executable: '/must/not/launch' });
    await expect(engine.init({ runId: 'run', targetName: 'wrong-host', projectRoot: '.', app: { appPath: './target' }, env: {}, headed: true, workerSlot: 0, signal })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('rejects unsupported or malformed runtime options', () => {
    const base: DesktopOptions = { backend, executable: process.execPath };
    for (const invalid of [null, [], { ...base, backend: '__proto__' }, { ...base, executable: '' }, { ...base, executable: 'a\0b' }, { ...base, args: 'script' }, { ...base, args: ['--'] }, { ...base, args: ['a\0b'] }, { ...base, screenshots: true }, { ...base, keyboard: true }, { ...base, actions: ['hover'] }, { ...base, actions: ['tap', 'tap'] }, { ...base, launchTimeout: -1 }]) {
      expect(() => desktop(invalid as unknown as DesktopOptions)).toThrow();
    }
    expect(() => desktop({ backend: 'macos-ax', executable: process.execPath, actions: ['selectOption'] })).not.toThrow();
    expect(() => desktop({ ...base, actions: [] })).toThrow();
    expect(() => desktop({ ...base, actions: ['tap'] })).not.toThrow();
  });
});
