import { connect, type Socket } from 'node:net';
import { EngineError, ENGINE_ERROR_CODES } from '@e2e-platform/core/engine';
import { NativeTransport, type RequestContext } from './native-transport.ts';

/** One connection, one in-flight request. A late answer cannot mutate the next request. */
export class JsonRpcTcpTransport extends NativeTransport {
  private readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: { id: number; resolve(value: unknown): void; reject(error: Error): void } | undefined;
  private closed = false;
  private readonly disconnectListeners = new Set<() => void>();

  private constructor(socket: Socket, private readonly maxMessageBytes: number) {
    super();
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () => this.disconnected('native bridge connection failed'));
    socket.on('close', () => this.disconnected('native bridge disconnected'));
  }

  static async connect(port: number, context: RequestContext, maxMessageBytes: number): Promise<JsonRpcTcpTransport> {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1 || maxMessageBytes > 2 ** 30) throw new EngineError('ENGINE_FAILURE', 'invalid native transport bounds', { retryable: false });
    validateContext(context);
    if (context.signal.aborted) throw cancelled();
    return new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      const timer = setTimeout(() => finish(new EngineError('OPERATION_TIMEOUT', 'native bridge connection timed out', { retryable: false })), context.timeoutMs);
      const abort = () => finish(cancelled());
      const error = () => finish(new EngineError('ENGINE_FAILURE', 'could not connect to native bridge', { retryable: false }));
      const finish = (failure?: Error) => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abort);
        socket.removeListener('error', error);
        socket.removeListener('connect', ready);
        if (failure !== undefined) { socket.destroy(); reject(failure); }
        else resolve(new JsonRpcTcpTransport(socket, maxMessageBytes));
      };
      const ready = () => finish();
      context.signal.addEventListener('abort', abort, { once: true });
      socket.once('error', error);
      socket.once('connect', ready);
    });
  }

  request(method: string, params: unknown, context: RequestContext, mutates = false): Promise<unknown> {
    validateContext(context);
    const deadline = Date.now() + context.timeoutMs;
    let sent = false;
    let settled = false;
    let cancelPending: (() => void) | undefined;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abort);
        if (error === undefined) resolve(value);
        else reject(error);
      };
      const interrupted = (abort: boolean) => {
        const error = sent && mutates
          ? new EngineError('ACTION_MAY_HAVE_COMMITTED', `native ${method} was sent but its outcome is unknown`, { retryable: false })
          : abort ? cancelled() : new EngineError('OPERATION_TIMEOUT', `native ${method} timed out`, { retryable: false });
        cancelPending?.();
        if (sent) this.close();
        finish(error);
      };
      const abort = () => interrupted(true);
      const timer = setTimeout(() => interrupted(false), Math.max(1, context.timeoutMs));
      context.signal.addEventListener('abort', abort, { once: true });
      const execute = async () => {
        if (settled) return;
        if (context.signal.aborted) { interrupted(true); return; }
        if (Date.now() >= deadline) { interrupted(false); return; }
        if (this.closed) { finish(new EngineError('ENGINE_FAILURE', 'native bridge is closed', { retryable: false })); return; }
        if (!Number.isSafeInteger(this.nextId)) { finish(new EngineError('ENGINE_FAILURE', 'native request id exhausted', { retryable: false })); return; }
        const id = this.nextId++;
        const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
        if (Buffer.byteLength(line) > this.maxMessageBytes) { finish(new EngineError('ENGINE_FAILURE', 'native request exceeds message limit', { retryable: false })); return; }
        await new Promise<void>((done) => {
          cancelPending = () => { this.pending = undefined; done(); };
          this.pending = {
            id,
            resolve: (value) => { this.pending = undefined; finish(undefined, value); done(); },
            reject: (error) => {
              this.pending = undefined;
              finish(sent && mutates && error instanceof EngineError && error.code === 'ENGINE_FAILURE'
                ? new EngineError('ACTION_MAY_HAVE_COMMITTED', `native ${method} disconnected after dispatch`, { retryable: false })
                : error);
              done();
            },
          };
          sent = true;
          this.socket.write(line);
        });
      };
      this.queue = this.queue.then(execute, execute).catch((error: unknown) => finish(error instanceof Error ? error : new EngineError('ENGINE_FAILURE', 'native request failed', { retryable: false })));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.fail(new EngineError('ENGINE_FAILURE', 'native bridge closed', { retryable: false }));
  }

  override onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private disconnected(message: string): void {
    const unexpected = !this.closed;
    this.closed = true;
    this.fail(new EngineError('ENGINE_FAILURE', message, { retryable: false }));
    if (unexpected) for (const listener of this.disconnectListeners) listener();
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxMessageBytes) { this.protocolFailure('native response exceeds message limit'); return; }
    for (;;) {
      const end = this.buffer.indexOf(10);
      if (end < 0) return;
      const line = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      try {
        const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        const pending = this.pending;
        if (pending === undefined || !isRecord(message) || message.jsonrpc !== '2.0' || message.id !== pending.id || ('result' in message) === ('error' in message)) throw new Error('invalid response');
        if ('error' in message) {
          const payload = message.error;
          if (!isRecord(payload) || !Number.isInteger(payload.code) || typeof payload.message !== 'string') throw new Error('invalid error');
          const data = isRecord(payload.data) ? payload.data : {};
          const code = typeof data.code === 'string' && ENGINE_ERROR_CODES.includes(data.code as typeof ENGINE_ERROR_CODES[number]) ? data.code as typeof ENGINE_ERROR_CODES[number] : 'ENGINE_FAILURE';
          pending.reject(new EngineError(code, `native bridge ${code}`, { retryable: code === 'NODE_STALE' || code === 'FRAME_NOT_FOUND' }));
        } else pending.resolve(message.result);
      } catch {
        this.protocolFailure('malformed or unexpected native response');
        return;
      }
    }
  }

  /** A protocol fault must reach the attempt even when no request is pending. */
  private protocolFailure(message: string): void {
    this.socket.destroy();
    this.disconnected(message);
  }

  private fail(error: EngineError): void { this.pending?.reject(error); this.pending = undefined; }
}

export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function cancelled(): EngineError { return new EngineError('CANCELLED', 'native operation cancelled', { retryable: false }); }
function validateContext(context: RequestContext): void {
  if (!Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0 || context.timeoutMs > 2 ** 31 - 1) throw new EngineError('ENGINE_FAILURE', 'invalid native request timeout', { retryable: false });
}
