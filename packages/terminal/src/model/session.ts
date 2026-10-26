import xterm from '@xterm/headless';
import type { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { setTimeout as delay } from 'node:timers/promises';
import { boundedInteger, TerminalError, type TerminalDimensions, type TerminalExit, type TerminalOperation, type TerminalSessionOptions, type TerminalSnapshot } from './types.ts';
import type { TerminalTransport, TerminalTransportFactory } from '../transport/base.ts';
import { encodeKey } from '../engine/keys.ts';

/** Reconstructs the terminal, including cursor motion, erase and alternate screen. */
export class TerminalSession {
  readonly #terminal: Terminal;
  readonly #transport: TerminalTransport;
  readonly #subscriptions: (() => void)[] = [];
  readonly #maxOutput: number;
  readonly #maxPending: number;
  readonly #timeout: number;
  readonly #transcript: string[] = [];
  readonly #lifetime = new AbortController();
  #outputBytes = 0;
  #pendingBytes = 0;
  #pending: Promise<void> = Promise.resolve();
  #failure: TerminalError | undefined;
  #exit: TerminalExit | undefined;
  #title = '';
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(transport: TerminalTransport, options: TerminalSessionOptions = {}) {
    const columns = boundedInteger(options.columns ?? 80, 'columns', 512);
    const rows = boundedInteger(options.rows ?? 24, 'rows', 200);
    const scrollback = options.scrollback ?? 500;
    if (!Number.isSafeInteger(scrollback) || scrollback < 0 || scrollback > 100_000) throw new TerminalError('INVALID_ARGUMENT', 'scrollback must be an integer from 0 through 100000');
    this.#maxOutput = boundedInteger(options.maxOutputBytes ?? 16 * 1024 * 1024, 'maxOutputBytes', 1024 * 1024 * 1024);
    this.#maxPending = boundedInteger(options.maxPendingBytes ?? Math.min(4 * 1024 * 1024, this.#maxOutput), 'maxPendingBytes', this.#maxOutput);
    this.#timeout = boundedInteger(options.timeoutMs ?? 30_000, 'timeoutMs', 2_147_483_647);
    this.#transport = transport;
    this.#terminal = new xterm.Terminal({ cols: columns, rows, scrollback, allowProposedApi: true, convertEol: false });
    this.#terminal.loadAddon(new Unicode11Addon());
    this.#terminal.unicode.activeVersion = '11';
    this.#subscriptions.push(transport.onData((data) => { this.#accept(data); }));
    this.#subscriptions.push(transport.onExit((exit) => { this.#exit = Object.freeze({ ...exit }); }));
    const title = this.#terminal.onTitleChange((value) => { this.#title = value; });
    // Query responses (cursor position, device attributes) must reach the app.
    const reply = this.#terminal.onData((data) => {
      if (!this.#closed && this.#exit === undefined) {
        Promise.resolve().then(() => this.#transport.write(data)).catch((cause: unknown) => {
          this.#fail(new TerminalError('TRANSPORT_FAILED', 'Terminal response write failed', { cause }));
        });
      }
    });
    this.#subscriptions.push(() => { title.dispose(); }, () => { reply.dispose(); });
  }

  static async create(factory: TerminalTransportFactory, options: TerminalSessionOptions = {}): Promise<TerminalSession> {
    const dimensions: TerminalDimensions = {
      columns: boundedInteger(options.columns ?? 80, 'columns', 512),
      rows: boundedInteger(options.rows ?? 24, 'rows', 200),
    };
    const transport = await factory(dimensions);
    try { return new TerminalSession(transport, options); }
    catch (cause) { await transport.close(); throw cause; }
  }

  get pid(): number | undefined { return this.#transport.pid; }
  get exit(): TerminalExit | undefined { return this.#exit; }

  /** Surfaces a latched session fault, including after the session closes. */
  assertHealthy(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }

  #fail(error: TerminalError): void {
    this.#failure ??= error;
    void this.close().catch(() => undefined);
  }

  #accept(data: string): void {
    if (this.#closed || this.#failure !== undefined) return;
    const bytes = Buffer.byteLength(data, 'utf8');
    this.#outputBytes += bytes;
    if (this.#outputBytes > this.#maxOutput || this.#pendingBytes + bytes > this.#maxPending) {
      this.#fail(new TerminalError('OUTPUT_LIMIT', 'Terminal output exceeded its configured byte budget'));
      return;
    }
    this.#transcript.push(data);
    this.#pendingBytes += bytes;
    this.#pending = this.#pending.then(() => new Promise<void>((resolve) => {
      if (this.#closed) { this.#pendingBytes -= bytes; resolve(); return; }
      this.#terminal.write(data, () => { this.#pendingBytes -= bytes; resolve(); });
    }));
  }

  async #bounded<T>(operation: (signal: AbortSignal) => Promise<T>, options: TerminalOperation): Promise<T> {
    this.assertHealthy();
    if (this.#closed) throw new TerminalError('CLOSED', 'Terminal session is closed');
    if (options.signal?.aborted === true) throw new TerminalError('ABORTED', 'Terminal operation was aborted');
    const timeoutMs = boundedInteger(options.timeoutMs ?? this.#timeout, 'timeoutMs', 2_147_483_647);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    let closed: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { const error = new TerminalError('TIMEOUT', `Terminal operation exceeded ${timeoutMs} ms`); controller.abort(error); reject(error); }, timeoutMs);
      abort = () => { const error = new TerminalError('ABORTED', 'Terminal operation was aborted'); controller.abort(error); reject(error); };
      options.signal?.addEventListener('abort', abort, { once: true });
      closed = () => { const error: unknown = this.#lifetime.signal.reason; controller.abort(error); reject(error); };
      this.#lifetime.signal.addEventListener('abort', closed, { once: true });
    });
    try {
      const result = await Promise.race([operation(controller.signal), interrupted]);
      this.assertHealthy();
      return result;
    } catch (cause) {
      if (controller.signal.reason instanceof TerminalError) throw controller.signal.reason;
      throw cause;
    } finally {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      if (abort !== undefined) options.signal?.removeEventListener('abort', abort);
      if (closed !== undefined) this.#lifetime.signal.removeEventListener('abort', closed);
    }
  }

  async snapshot(options: TerminalOperation = {}): Promise<TerminalSnapshot> {
    return this.#bounded(async () => {
      await this.#pending;
      const buffer = this.#terminal.buffer.active;
      const lines = Array.from({ length: this.#terminal.rows }, (_unused, index) => buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? '');
      return Object.freeze({
        columns: this.#terminal.cols, rows: this.#terminal.rows,
        lines: Object.freeze(lines), text: lines.join('\n'),
        cursor: Object.freeze({ column: buffer.cursorX, row: buffer.cursorY }),
        alternate: buffer.type === 'alternate', title: this.#title,
        ...(this.#exit === undefined ? {} : { exit: this.#exit }),
      });
    }, options);
  }

  /** Literal PTY input, not a shell command execution API. */
  async write(data: string, options: TerminalOperation = {}): Promise<void> {
    return this.#bounded(async () => {
      if (this.#exit !== undefined) throw new TerminalError('EXITED', `Terminal process exited with ${this.#exit.exitCode}`);
      await this.#transport.write(data);
    }, options);
  }

  async press(key: string, options: TerminalOperation = {}): Promise<void> {
    await this.#bounded(async (signal) => {
      await this.#pending;
      await this.write(encodeKey(key, { applicationCursorKeys: this.#terminal.modes.applicationCursorKeysMode }), { ...options, signal });
    }, options);
  }

  async resize(columns: number, rows: number, options: TerminalOperation = {}): Promise<void> {
    boundedInteger(columns, 'columns', 512);
    boundedInteger(rows, 'rows', 200);
    return this.#bounded(async () => {
      await this.#pending;
      if (this.#exit !== undefined) throw new TerminalError('EXITED', 'Cannot resize an exited terminal');
      await this.#transport.resize(columns, rows);
      this.#terminal.resize(columns, rows);
    }, options);
  }

  /** Polls the reconstructed visible screen; stateful regex lastIndex is ignored. */
  async waitFor(pattern: string | RegExp, options: TerminalOperation = {}): Promise<TerminalSnapshot> {
    return this.#bounded(async (signal) => {
      for (;;) {
        const current = await this.snapshot({ ...options, signal });
        const matches = typeof pattern === 'string' ? current.text.includes(pattern) : new RegExp(pattern.source, pattern.flags).test(current.text);
        if (matches) return current;
        if (this.#exit !== undefined) throw new TerminalError('EXITED', `Terminal exited before the expected screen appeared (${this.#exit.exitCode})`);
        await delay(10, undefined, { signal });
      }
    }, options);
  }

  /** Bounded raw stream for diagnostics; may contain application secrets. */
  transcript(): string { return this.#transcript.join(''); }

  /** Attempts every release once and reports collected failures afterward. */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      for (const dispose of this.#subscriptions.splice(0)) {
        try { dispose(); } catch (cause) { failures.push(cause); }
      }
      try { await this.#transport.close(); } catch (cause) { failures.push(cause); }
      try { this.#terminal.dispose(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError(failures, 'Terminal session cleanup failed');
    });
    this.#lifetime.abort(this.#failure ?? new TerminalError('CLOSED', 'Terminal session is closed'));
    return this.#closing;
  }
}
