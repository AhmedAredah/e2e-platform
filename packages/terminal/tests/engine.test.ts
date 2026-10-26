import { afterEach, describe, expect, test, vi } from 'vitest';
import type { EngineAttemptContext, EngineSnapshot, OperationContext } from '@e2e-cpp/core/engine';
import { TerminalEngine, terminal } from '../src/engine/terminal.ts';
import type { TerminalSnapshot } from '../src/model/types.ts';
import { MemoryTransport } from './helpers.ts';

class InspectableTerminalEngine extends TerminalEngine {
  readonly transports: MemoryTransport[] = [];
  protected override createTransport(): MemoryTransport {
    const transport = new MemoryTransport();
    this.transports.push(transport);
    return transport;
  }
  protected override semanticSnapshot(snapshot: TerminalSnapshot, observed: boolean): EngineSnapshot {
    const mapped = super.semanticSnapshot(snapshot, observed);
    return { ...mapped, root: { ...mapped.root, attributes: { ...mapped.root.attributes, backend: 'fixture' } } };
  }
}
const engines: TerminalEngine[] = [];
afterEach(async () => { await Promise.all(engines.splice(0).map((engine) => engine.dispose())); });
const operation = (): OperationContext => ({ signal: new AbortController().signal, timeoutMs: 1000, runId: 'run', attemptId: 'attempt', origin: 'test' });
const attempt = (): EngineAttemptContext => ({
  attemptId: 'attempt', artifactsDir: '/tmp/terminal-test', signal: new AbortController().signal,
  appLog: () => undefined, environment: () => undefined,
});

describe('terminal engine contract and subclass seams', () => {
  test('subclass transport/controller shares lifecycle, locators and input without invented widgets', async () => {
    const engine = new InspectableTerminalEngine({ columns: 30, rows: 4 });
    engines.push(engine);
    engine.validateApp({ appPath: 'dummy' }, { targetName: 'fixture' });
    await engine.init({ runId: 'run', targetName: 'fixture', projectRoot: process.cwd(), app: { appPath: 'dummy' }, env: {}, headed: false, workerSlot: 0, signal: new AbortController().signal });
    await engine.startAttempt(attempt());
    const transport = engine.transports[0]!;
    transport.emit('Menu\r\nReady');
    const observed = await engine.observe(operation());
    expect(observed.root.role).toBe('terminal');
    expect(observed.root.attributes?.backend).toBe('fixture');
    expect(observed.root.children?.map((node) => node.role)).toEqual(['text', 'text', 'text', 'text']);
    const matches = await engine.locate({ kind: 'query', query: { kind: 'text', value: { kind: 'string', value: 'Ready', exact: true } } }, operation());
    expect(matches).toHaveLength(1);
    await engine.keyboard.type('Ada', { replace: false }, operation());
    await engine.keyboard.press('Enter', operation());
    expect(transport.writes).toEqual(['Ada', '\r']);
    await expect(engine.keyboard.type('x', { replace: true }, operation())).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await engine.session.restart(operation());
    expect(transport.closed).toBe(1);
    expect(engine.transports).toHaveLength(2);
  });
  test('factory advertises observation/location/keyboard only', () => {
    const handle = terminal({ transportFactory: () => new MemoryTransport() });
    expect(handle.capabilities.has('observation')).toBe(true);
    expect(handle.capabilities.has('keyboard')).toBe(true);
    expect(handle.capabilities.has('location')).toBe(true);
    expect(handle.capabilities.has('pointer')).toBe(false);
    expect(handle.capabilities.has('actions')).toBe(false);
    expect(handle.capabilities.has('artifacts')).toBe(false);
  });
  test('requires an app path and rejects web/mobile app declarations', () => {
    const engine = new TerminalEngine();
    expect(() => engine.validateApp({}, { targetName: 'bad' })).toThrow('app.appPath');
    expect(() => engine.validateApp({ appPath: 'x', url: 'https://example.com' }, { targetName: 'bad' })).toThrow('appPath and launchArguments');
  });
  test('late transport startup after attempt teardown is closed instead of leaked', async () => {
    let provide: ((transport: MemoryTransport) => void) | undefined;
    const engine = new TerminalEngine({ transportFactory: () => new Promise<MemoryTransport>((resolve) => { provide = resolve; }) });
    engines.push(engine);
    const starting = engine.startAttempt(attempt());
    const rejected = expect(starting).rejects.toMatchObject({ code: 'ABORTED' });
    await vi.waitFor(() => expect(provide).toBeDefined());
    await engine.endAttempt();
    const transport = new MemoryTransport();
    provide!(transport);
    await rejected;
    await vi.waitFor(() => expect(transport.closed).toBe(1));
  });
});

test('restart rejects overlap, honors pre-abort, and cannot escape into the next attempt', async () => {
  let provide: ((transport: MemoryTransport) => void) | undefined;
  const first = new MemoryTransport();
  let calls = 0;
  const engine = new TerminalEngine({ transportFactory: () => ++calls === 1 ? first : new Promise<MemoryTransport>((resolve) => { provide = resolve; }) });
  engines.push(engine);
  await engine.startAttempt(attempt());
  await expect(engine.session.restart({ ...operation(), signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(first.closed).toBe(0);
  expect(calls).toBe(1);
  const restarting = engine.session.restart(operation()).catch((cause: unknown) => cause);
  await vi.waitFor(() => expect(provide).toBeDefined());
  await expect(engine.session.restart(operation())).rejects.toMatchObject({ code: 'INVALID_STATE' });
  await engine.endAttempt();
  expect(await restarting).toMatchObject({ code: 'CANCELLED' });
  const late = new MemoryTransport();
  provide!(late);
  await vi.waitFor(() => expect(late.closed).toBe(1));
  expect(first.closed).toBe(1);
});

test('bounds a stalled factory and closes any transport delivered after timeout', async () => {
  let provide: ((transport: MemoryTransport) => void) | undefined;
  const engine = new TerminalEngine({ timeoutMs: 30, transportFactory: () => new Promise<MemoryTransport>((resolve) => { provide = resolve; }) });
  engines.push(engine);
  await expect(engine.startAttempt(attempt())).rejects.toMatchObject({ code: 'TIMEOUT' });
  await engine.endAttempt();
  const late = new MemoryTransport();
  provide!(late);
  await vi.waitFor(() => expect(late.closed).toBe(1));
});

test('teardown waits for a close already owned by restart', async () => {
  let finishClose: (() => void) | undefined;
  class SlowCloseTransport extends MemoryTransport {
    override async close(): Promise<void> {
      await new Promise<void>((resolve) => { finishClose = resolve; });
      await super.close();
    }
  }
  const transport = new SlowCloseTransport();
  let acquisitions = 0;
  const engine = new TerminalEngine({ transportFactory: () => { acquisitions++; return transport; } });
  engines.push(engine);
  await engine.startAttempt(attempt());
  const restarting = engine.session.restart(operation()).catch((cause: unknown) => cause);
  await vi.waitFor(() => expect(finishClose).toBeDefined());
  let disposed = false;
  const disposing = engine.dispose().then(() => { disposed = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(disposed).toBe(false);
  finishClose!();
  await disposing;
  expect(await restarting).toMatchObject({ code: 'CANCELLED' });
  expect(acquisitions).toBe(1);
  expect(transport.closed).toBe(1);
});
