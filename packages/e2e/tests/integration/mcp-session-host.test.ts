/**
 * The session host in-process on the fake engine: the headed flag reaches the
 * engine, an idle session closes itself, the TTL ends a session through the
 * step's own deadline, and an `open_session` that fails after the attempt
 * opened tears the attempt down and leaves the host ready for the next one.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEngine, type FakeEngineHandle } from '../helpers/fake-engine.ts';

const sessionModule = new URL('../../dist/mcp/session.js', import.meta.url).href;
const { SessionHost } = (await import(sessionModule)) as typeof import('../../src/mcp/session.ts');
const resolveModule = new URL('../../dist/config/resolve.js', import.meta.url).href;
const { resolveConfig } = (await import(resolveModule)) as typeof import('../../src/config/resolve.ts');
const secretsModule = new URL('../../dist/secrets.js', import.meta.url).href;
const { credentials } = (await import(secretsModule)) as typeof import('../../src/secrets.ts');
const standaloneModule = new URL('../../dist/run/standalone.js', import.meta.url).href;
const { openStandaloneAttempt } = (await import(standaloneModule)) as typeof import('../../src/run/standalone.ts');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Holds one lifecycle phase until the test releases it. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('SessionHost', { timeout: 60_000 }, () => {
  let dir: string;
  let logs: string[];

  const host = (fake: FakeEngineHandle, options: { headed?: boolean; idleMs?: number; ttlMs?: number } = {}) => {
    const config = resolveConfig(
      { targets: [{ name: 'kiosk', platform: 'kiosk', engine: fake.engine }], credentials: { admin: { username: 'admin', password: 'pw' } } } as never,
      { projectRoot: dir, env: {} },
    );
    return new SessionHost({
      loadConfig: async () => config,
      env: {},
      headed: options.headed ?? false,
      log: (level, message) => logs.push(`${level}: ${message}`),
      idleMs: options.idleMs,
      ttlMs: options.ttlMs,
    });
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-mcp-host-'));
    logs = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('boots the engine headed when asked and headless otherwise', async () => {
    const fake = createFakeEngine();
    const headed = host(fake, { headed: true });
    const text = await headed.open({});
    expect(text).toContain('), headed;');
    expect(fake.inits[0]?.headed).toBe(true);
    await headed.close('done');
    const headless = host(fake, { headed: false });
    await headless.open({});
    expect(fake.inits[1]?.headed).toBe(false);
    await headless.close('done');
    expect(fake.stats()).toMatchObject({ attemptsStarted: 2, attemptsEnded: 2, disposes: 2 });
  });

  it('closes an idle session and disposes the engine', async () => {
    const fake = createFakeEngine();
    const idle = host(fake, { idleMs: 300 });
    await idle.open({});
    expect(idle.isOpen).toBe(true);
    await sleep(1_000);
    expect(idle.isOpen).toBe(false);
    expect(logs.some((line) => line.includes('idle for'))).toBe(true);
    expect(fake.stats()).toMatchObject({ attemptsStarted: 1, attemptsEnded: 1, disposes: 1 });
  });

  it('ends a session at its TTL through the step deadline', async () => {
    const fake = createFakeEngine();
    const short = host(fake, { ttlMs: 1_000 });
    await short.open({});
    await sleep(3_000);
    expect(short.isOpen).toBe(false);
    expect(logs.some((line) => line.includes('exceeded its 1000 ms timeout'))).toBe(true);
    expect(fake.stats()).toMatchObject({ attemptsEnded: 1, disposes: 1 });
  });

  it('keeps the credential registry of a session opened while the previous one closes', async () => {
    const fake = createFakeEngine();
    const first = host(fake);
    await first.open({});
    const closing = first.close('done');
    const second = host(fake);
    await second.open({});
    await closing;
    expect(credentials.user('admin').username).toBe('admin');
    await second.close('done');
    expect(() => credentials.user('admin')).toThrow(/only available while the e2e runner is active/);
  });

  it('waits for an in-flight open and tears it down before server shutdown completes', async () => {
    const launching = deferred();
    const ready = deferred();
    const fake = createFakeEngine({ onStartAttempt: async () => { launching.resolve(); await ready.promise; } });
    const session = host(fake);
    const opening = session.open({});
    await launching.promise;
    let closed = false;
    const closing = session.close('server shutdown').then((summary) => { closed = true; return summary; });
    await sleep(10);
    expect(closed).toBe(false);
    ready.resolve();
    await opening;
    expect(await closing).toContain('server shutdown');
    expect(session.isOpen).toBe(false);
    expect(fake.stats()).toMatchObject({ attemptsStarted: 1, attemptsEnded: 1, disposes: 1 });
  });

  it('rejects a replacement open until prior disposal finishes and shares concurrent closes', async () => {
    const disposed = deferred();
    const fake = createFakeEngine({ onDispose: () => disposed.promise });
    const session = host(fake);
    await session.open({});
    const closing = session.close('done');
    await vi.waitFor(() => expect(fake.stats().disposes).toBe(1));
    await expect(session.open({})).rejects.toThrow(/still closing/);
    const repeated = session.close('done again');
    disposed.resolve();
    expect(await repeated).toBe(await closing);
    await session.open({});
    await session.close('done');
    expect(fake.stats()).toMatchObject({ attemptsStarted: 2, attemptsEnded: 2, disposes: 2, maxConcurrentAttempts: 1 });
  });

  it('runs service teardown and releases credentials if artifact-directory creation fails', async () => {
    const marker = path.join(dir, 'service-stopped');
    const fake = createFakeEngine({ app: { services: [{
      name: 'setup', executable: process.execPath, args: ['-e', 'process.exit(0)'], waitForExit: true,
      teardown: { executable: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'stopped')`] },
    }] } });
    mkdirSync(path.join(dir, '.e2e'));
    writeFileSync(path.join(dir, '.e2e', 'artifacts'), 'an unexpected file');
    await expect(host(fake).open({})).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
    expect(fake.stats()).toMatchObject({ attemptsStarted: 0, attemptsEnded: 0, disposes: 1 });
    expect(() => credentials.user('admin')).toThrow(/only available while the e2e runner is active/);
  });

  it('cancels a standalone attempt fixture budget when the attempt closes', async () => {
    const fake = createFakeEngine();
    const config = resolveConfig({ targets: [{ name: 'kiosk', platform: 'kiosk', engine: fake.engine }] }, { projectRoot: dir, env: {} });
    const attempt = await openStandaloneAttempt({
      config, target: config.targets[0]!, headed: false, env: {}, signal: new AbortController().signal,
      timeoutMs: 5_000, artifactsRoot: path.join(dir, '.e2e', 'artifacts'),
    });
    await attempt.close();
    expect(attempt.budget.signal.aborted).toBe(true);
    const previous = fake.operations.length;
    await expect(attempt.fixtures.app.open('/')).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(attempt.fixtures.screen.getByRole('button').textContent()).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.operations).toHaveLength(previous);
  });

  it('tears down an attempt whose first observation failed, then opens the next one', async () => {
    let broken = true;
    const fake = createFakeEngine({
      observe: () => {
        if (broken) throw new Error('screen unavailable');
      },
    });
    const flaky = host(fake);
    await expect(flaky.open({})).rejects.toThrow(/screen unavailable/);
    expect(flaky.isOpen).toBe(false);
    expect(fake.stats()).toMatchObject({ attemptsStarted: 1, attemptsEnded: 1, disposes: 1 });
    broken = false;
    const text = await flaky.open({});
    expect(text).toContain('button "Submit"');
    await flaky.close('done');
    expect(fake.stats()).toMatchObject({ attemptsStarted: 2, attemptsEnded: 2, disposes: 2 });
  });
});
