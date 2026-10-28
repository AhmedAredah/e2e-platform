import type { FixtureContext, TestFixtures } from '@e2e-platform/core';
import type { ProcessFixture, ProcessOptions, ProcessResult, ProcessSession } from '@e2e-platform/process';
import type { NativeApp } from '@e2e-platform/native';
import type { TerminalFixture } from '@e2e-platform/terminal';
import { invalid, record, string, timeout } from './protocol.ts';

export type HostFixtures = TestFixtures & { processes: ProcessFixture; native?: NativeApp; terminal?: TerminalFixture };

/** Validates direct process launch fields before allocating an owned resource. */
export function processOptions(p: Record<string, unknown>, context: FixtureContext): ProcessOptions {
  if (p.args !== undefined && (!Array.isArray(p.args) || p.args.length > 1024)) invalid();
  if (p.inheritEnv !== undefined && typeof p.inheritEnv !== 'boolean') invalid();
  if (p.stdin !== undefined && p.stdinBase64 !== undefined) invalid();
  const input = p.stdinBase64 === undefined ? undefined : string(p.stdinBase64, 256 * 1024);
  if (input !== undefined && Buffer.from(input, 'base64').toString('base64') !== input) invalid();
  const env = p.env === undefined ? undefined : Object.fromEntries(Object.entries(record(p.env)).map(([key, value]) => [string(key, 1024), value === null ? undefined : string(value, 65536)]));
  return {
    executable: string(p.executable), args: (p.args as unknown[] | undefined)?.map(value => string(value)) ?? [],
    ...(p.cwd === undefined ? {} : { cwd: string(p.cwd) }),
    ...(env === undefined ? {} : { env }),
    ...(p.inheritEnv === undefined ? {} : { inheritEnv: p.inheritEnv as boolean }),
    ...(p.stdin === undefined ? {} : { stdin: string(p.stdin) }),
    ...(input === undefined ? {} : { stdin: Buffer.from(input, 'base64') }),
    timeoutMs: timeout(p.timeoutMs, 30_000), maxOutputBytes: 128 * 1024, signal: context.signal,
  };
}

/** Encodes binary output without lossy replacement decoding. */
export function binaryResult(result: ProcessResult): object {
  return { status: result.status, exitCode: result.exitCode, signal: result.signal,
    stdout: result.stdout.bytes.toString('base64'), stderr: result.stderr.bytes.toString('base64'),
    truncated: result.stdout.truncated || result.stderr.truncated };
}

/** Owns opaque process handles; all children also remain owned by the attempt fixture. */
export class ResourceDispatcher {
  private readonly children = new Map<number, { session: ProcessSession; result?: ProcessResult }>();
  private next = 0;
  constructor(private readonly fixtures: HostFixtures, private readonly context: FixtureContext) {}

  /** Dispatches only public optional fixtures and bounded process operations. */
  async dispatch(method: string, p: Record<string, unknown>): Promise<unknown> {
    if (method === 'process.start') {
      record(p, ['executable', 'args', 'cwd', 'env', 'inheritEnv', 'stdin', 'timeoutMs']);
      if (this.next >= 128) invalid();
      const session = await this.fixtures.processes.start(processOptions(p, this.context));
      const handle = ++this.next;
      const entry: { session: ProcessSession; result?: ProcessResult } = { session };
      this.children.set(handle, entry);
      void session.result.then(result => { entry.result = result; }, () => {});
      return { handle, pid: session.pid };
    }
    if (method.startsWith('process.')) {
      record(p, method === 'process.write' ? ['handle', 'data'] : ['handle']);
      if (!Number.isSafeInteger(p.handle)) invalid();
      const child = this.children.get(p.handle as number);
      if (child === undefined) invalid();
      if (method === 'process.read') {
        if (child.result?.ioError !== undefined) throw child.result.ioError;
        return { stdout: child.session.stdout.bytes.toString('base64'), stderr: child.session.stderr.bytes.toString('base64'),
          truncated: child.session.stdout.truncated || child.session.stderr.truncated,
          result: child.result === undefined ? null : binaryResult(child.result) };
      }
      if (method === 'process.stop') {
        const result = await child.session.stop();
        if (result.ioError !== undefined) throw result.ioError;
        return binaryResult(result);
      }
      if (method === 'process.write') {
        const data = string(p.data, 256 * 1024);
        if (Buffer.from(data, 'base64').toString('base64') !== data) invalid();
        await child.session.write(Buffer.from(data, 'base64')); return null;
      }
      if (method === 'process.closeInput') { await child.session.closeInput(); return null; }
      invalid();
    }
    if (method.startsWith('terminal.')) {
      const terminal = this.fixtures.terminal;
      if (terminal === undefined) throw new Error('Target does not provide a terminal fixture');
      switch (method) {
        case 'terminal.snapshot': record(p, []); return terminal.snapshot();
        case 'terminal.write': record(p, ['text']); await terminal.write(string(p.text)); return null;
        case 'terminal.press': record(p, ['key']); await terminal.press(string(p.key)); return null;
        case 'terminal.waitFor': record(p, ['text', 'timeoutMs']); return terminal.waitFor(string(p.text), { timeoutMs: timeout(p.timeoutMs, 5000) });
        case 'terminal.resize':
          record(p, ['columns', 'rows']);
          if (!Number.isInteger(p.columns) || !Number.isInteger(p.rows)) invalid();
          await terminal.resize(p.columns as number, p.rows as number); return null;
        default: invalid();
      }
    }
    const native = this.fixtures.native;
    if (method === 'native.windows') { record(p, []); if (native === undefined) throw new Error('Target does not provide native windows'); return native.windows(); }
    if (method === 'native.activateWindow') { record(p, ['id']); if (native === undefined) throw new Error('Target does not provide native windows'); await native.activateWindow(string(p.id)); return null; }
    invalid();
  }
}
