import type { FixtureContext, TestFixtures } from '@e2e-platform/core';
import type { ProcessFixture, ProcessRunner } from '@e2e-platform/process';
import { CppDispatcher } from './dispatch.ts';
import { LineDecoder, MAX_LINE_BYTES, MAX_REQUESTS, invalid, parseRequest } from './protocol.ts';

export interface CppTestOptions {
  /** Path to the compiled test executable; commands never pass through a shell. */
  readonly executable: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Each test runs in a fresh owned child, bounded by this and the attempt deadline. */
  readonly timeoutMs?: number;
  /** Bounds the executable's side-effect-free --e2e-list invocation. */
  readonly discoveryTimeoutMs?: number;
  /** Explicit supervisor for discovery, test children and commands; never silently substituted. */
  readonly runner?: ProcessRunner;
}

/** Owns a C++ test's transport for the duration of one runner attempt. */
export class CppTestHost {
  constructor(private readonly fixtures: TestFixtures & { processes: ProcessFixture }, private readonly context: FixtureContext) {}

  /** Serves synchronous requests with byte bounds and exactly one in-flight operation. */
  async run(options: CppTestOptions, name: string): Promise<void> {
    const controller = new AbortController();
    const context = this.context;
    const combinedContext: FixtureContext = { ...context, get signal() { return AbortSignal.any([context.signal, controller.signal]); } };
    const dispatch = new CppDispatcher(this.fixtures, combinedContext);
    const child = await this.fixtures.processes.start({
      executable: options.executable, args: [...options.args ?? [], '--e2e-case', name],
      ...(options.env === undefined ? {} : { env: options.env }),
      timeoutMs: options.timeoutMs ?? 30_000, signal: combinedContext.signal,
      maxOutputBytes: MAX_LINE_BYTES,
    });
    const decoder = new LineDecoder();
    let lastId = 0;
    let requests = 0;
    let busy = false;
    let failed: Error | undefined;
    let dispatchFailure: unknown;
    const active = new Set<Promise<void>>();
    let writing = Promise.resolve();
    let rejectFailure: (error: Error) => void = () => {};
    const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
    // Attach before consuming the captured prefix; the callbacks run on the same event loop.
    const fail = (): void => {
      failed ??= new Error('C++ test protocol or transport failed');
      rejectFailure(failed);
      controller.abort();
    };
    // Observe immediately: a malformed captured prefix can fail before the result race starts.
    void failure.catch(() => {});
    const receive = (bytes: Buffer): void => {
      if (failed !== undefined) return;
      try {
        decoder.push(bytes, line => {
          if (busy || ++requests > MAX_REQUESTS) invalid();
          const request = parseRequest(line);
          if (request.id <= lastId) invalid();
          lastId = request.id; busy = true;
          const previousWrite = writing;
          const task = (async () => {
            await previousWrite;
            if (controller.signal.aborted || failed !== undefined) throw new Error('C++ test transport stopped');
            let response: object;
            try { response = { protocol: 1, id: request.id, result: await dispatch.dispatch(request) }; }
            catch (cause) {
              dispatchFailure ??= cause ?? new Error('C++ requested operation failed');
              response = { protocol: 1, id: request.id, error: { message: 'C++ requested operation failed' } };
            }
            const data = JSON.stringify(response);
            if (Buffer.byteLength(data) > MAX_LINE_BYTES) invalid();
            let completeWrite: () => void = () => {};
            let rejectWrite: (cause: unknown) => void = () => {};
            writing = new Promise<void>((resolve, reject) => { completeWrite = resolve; rejectWrite = reject; });
            void writing.catch(() => {});
            busy = false;
            try { await child.write(`${data}\n`); completeWrite(); }
            catch (cause) { rejectWrite(cause); throw cause; }
          })().catch(fail);
          active.add(task);
          void task.then(() => { active.delete(task); });
        });
      } catch { fail(); }
    };
    const unsubscribe = child.onOutput(event => { if (event.stream === 'stdout') receive(event.bytes); });
    let operationFailure: unknown;
    let cleanupFailure: unknown;
    try {
      if (child.stdout.truncated) invalid();
      receive(child.stdout.bytes);
      const result = await Promise.race([child.result, failure]);
      decoder.finish();
      if (failed !== undefined) throw failed;
      if (busy) throw new Error('C++ test exited with an unfinished operation');
      if (dispatchFailure !== undefined) throw dispatchFailure;
      if (result.status !== 'exited' || result.exitCode !== 0 || result.ioError !== undefined) throw new Error('C++ test failed, exceeded its deadline, or could not clean up');
    } catch (cause) { operationFailure = cause; } finally {
      unsubscribe(); controller.abort();
      try {
        const result = await child.stop();
        if (result.ioError !== undefined) cleanupFailure = new Error('C++ test cleanup failed');
      } catch { cleanupFailure = new Error('C++ test cleanup failed'); }
      await Promise.allSettled(active);
    }
    if (operationFailure !== undefined && cleanupFailure !== undefined) throw new AggregateError([operationFailure, cleanupFailure], 'C++ test and cleanup failed');
    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (operationFailure !== undefined) throw operationFailure;
    if (failed !== undefined) throw failed;
    if (dispatchFailure !== undefined) throw dispatchFailure;
  }
}
