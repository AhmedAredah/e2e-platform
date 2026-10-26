import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TerminalSession } from '../src/model/session.ts';
import { MemoryTransport } from './helpers.ts';

const sessions: TerminalSession[] = [];
function create(options: ConstructorParameters<typeof TerminalSession>[1] = {}): { terminal: TerminalSession; transport: MemoryTransport } {
  const transport = new MemoryTransport();
  const terminal = new TerminalSession(transport, { columns: 40, rows: 4, ...options });
  sessions.push(terminal);
  return { terminal, transport };
}
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.close())); });

describe('real VT screen reconstruction', () => {
  test('cursor movement and erase replace content instead of matching raw lines', async () => {
    const { terminal, transport } = create();
    transport.emit('Status: old\rStatus: new\x1b[K');
    const screen = await terminal.snapshot();
    expect(screen.lines[0]).toBe('Status: new');
    expect(screen.text).not.toContain('old');
    expect(terminal.transcript()).toContain('old');
  });
  test('handles Unicode cell widths, color escapes, absolute cursor and title', async () => {
    const { terminal, transport } = create();
    transport.emit('\x1b]0;Demo title\x07\x1b[2;3H\x1b[31m界😀\x1b[0m');
    const screen = await terminal.snapshot();
    expect(screen.lines[1]).toBe('  界😀');
    expect(screen.cursor).toEqual({ column: 6, row: 1 });
    expect(screen.title).toBe('Demo title');
    expect(screen.text).not.toContain('\x1b');
  });
  test('enters and restores the alternate screen', async () => {
    const { terminal, transport } = create();
    transport.emit('main\x1b[?1049h\x1b[2J\x1b[Halternate');
    expect(await terminal.snapshot()).toMatchObject({ alternate: true, lines: ['alternate', '', '', ''] });
    transport.emit('\x1b[?1049l');
    expect(await terminal.snapshot()).toMatchObject({ alternate: false, lines: ['main', '', '', ''] });
  });
  test('resizes both transport and emulator and preserves pending application redraw', async () => {
    const { terminal, transport } = create({ columns: 8 });
    transport.emit('abcdefghi');
    expect((await terminal.snapshot()).lines.slice(0, 2)).toEqual(['abcdefgh', 'i']);
    await terminal.resize(12, 3);
    const screen = await terminal.snapshot();
    expect(screen.columns).toBe(12);
    expect(screen.rows).toBe(3);
    expect(screen.lines.slice(0, 2)).toEqual(['abcdefgh', 'i']);
    transport.emit('\x1b[2J\x1b[Habcdefghi');
    expect((await terminal.snapshot()).lines[0]).toBe('abcdefghi');
    expect(transport.sizes).toEqual([[12, 3]]);
  });
  test('replies to terminal device queries through the transport', async () => {
    const { terminal, transport } = create();
    transport.emit('\x1b[6n');
    await terminal.snapshot();
    expect(transport.writes).toContain('\x1b[1;1R');
  });
  test('waitFor matches current screen and cancels its polling after timeout', async () => {
    const { terminal } = create();
    const spy = vi.spyOn(terminal, 'snapshot');
    await expect(terminal.waitFor('missing', { timeoutMs: 25 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    const count = spy.mock.calls.length;
    await delay(35);
    expect(spy.mock.calls.length).toBe(count);
  });
  test('supports cancellation and process-exit diagnosis', async () => {
    const { terminal, transport } = create();
    const controller = new AbortController();
    const pending = terminal.waitFor('missing', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    transport.finish({ exitCode: 9 });
    expect((await terminal.snapshot()).exit?.exitCode).toBe(9);
    await expect(terminal.write('x')).rejects.toMatchObject({ code: 'EXITED' });
    await expect(terminal.waitFor('missing')).rejects.toMatchObject({ code: 'EXITED' });
  });
  test('bounds output and closes once on failure', async () => {
    const { terminal, transport } = create({ maxOutputBytes: 5 });
    transport.emit('123456');
    await expect(terminal.snapshot()).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    await terminal.close();
    await terminal.close();
    expect(transport.closed).toBe(1);
  });
  test('respects application-cursor mode when sending arrows', async () => {
    const { terminal, transport } = create();
    transport.emit('\x1b[?1h');
    await terminal.press('ArrowDown');
    expect(transport.writes).toEqual(['\x1bOB']);
  });
  test('closing interrupts outstanding screen waits promptly', async () => {
    const { terminal } = create();
    const pending = expect(terminal.waitFor('missing')).rejects.toMatchObject({ code: 'CLOSED' });
    await terminal.close();
    await pending;
  });
  test('close attempts every release and keeps its aggregate failure idempotent', async () => {
    const failures = [new Error('data unsubscribe'), new Error('exit unsubscribe'), new Error('transport close')];
    class FailingCleanupTransport extends MemoryTransport {
      readonly released: string[] = [];
      override onData(listener: (data: string) => void): () => void {
        const unsubscribe = super.onData(listener);
        return () => { unsubscribe(); this.released.push('data'); throw failures[0]; };
      }
      override onExit(listener: Parameters<MemoryTransport['onExit']>[0]): () => void {
        const unsubscribe = super.onExit(listener);
        return () => { unsubscribe(); this.released.push('exit'); throw failures[1]; };
      }
      override close(): Promise<void> { this.closed++; throw failures[2]; }
    }
    const transport = new FailingCleanupTransport();
    const terminal = new TerminalSession(transport);
    const closing = terminal.close();
    expect(terminal.close()).toBe(closing);
    await expect(closing).rejects.toMatchObject({ errors: failures });
    expect(transport.released).toEqual(['data', 'exit']);
    expect(transport.closed).toBe(1);
    await expect(terminal.snapshot()).rejects.toMatchObject({ code: 'CLOSED' });
  });
});
