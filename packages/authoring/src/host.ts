import type { FixtureContext, TestFixtures } from '@e2e-platform/core';
import type { ProcessFixture, ProcessRunner } from '@e2e-platform/process';
import { AuthoringDispatcher } from './dispatch.ts';
import { LineDecoder, MAX_LINE_BYTES, MAX_REQUESTS, invalid, parseRequest, record, string } from './protocol.ts';

export interface AuthoredTestOptions {
  /** Path to the compiled test executable; commands never pass through a shell. */
  readonly executable: string;
  readonly cwd?: string;
  readonly language?: 'C++' | 'Python';
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Each test runs in a fresh owned child, bounded by this and the attempt deadline. */
  readonly timeoutMs?: number;
  /** Bounds the executable's side-effect-free --e2e-list invocation. */
  readonly discoveryTimeoutMs?: number;
  /** Explicit supervisor for discovery, test children and commands; never silently substituted. */
  readonly runner?: ProcessRunner;
}

/** Owns an authored test's transport for the duration of one runner attempt. */
export class AuthoredTestHost {
  constructor(private readonly fixtures: TestFixtures & { processes: ProcessFixture }, private readonly context: FixtureContext, private readonly language: 'C++' | 'Python' = 'C++') {}

  /** Serves synchronous requests with byte bounds and exactly one in-flight operation. */
  async run(options: AuthoredTestOptions, name: string): Promise<'passed' | 'skipped'> {
    const controller = new AbortController();
    const context = this.context;
    const combinedContext: FixtureContext = { ...context, get signal() { return AbortSignal.any([context.signal, controller.signal]); } };
    const dispatch = new AuthoringDispatcher(this.fixtures, combinedContext, this.language);
    const child = await this.fixtures.processes.start({
      executable: options.executable, args: [...options.args ?? [], '--e2e-case', name],
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      timeoutMs: options.timeoutMs ?? 30_000, signal: combinedContext.signal,
      maxOutputBytes: MAX_LINE_BYTES,
    });
    const decoder = new LineDecoder();
    let lastId = 0;
    let requests = 0;
    let busy = false;
    let started = false;
    let completed = false;
    let outcome: 'passed' | 'skipped' = 'passed';
    let failed: Error | undefined;
    let dispatchFailure: unknown;
    const active = new Set<Promise<void>>();
    let writing = Promise.resolve();
    let rejectFailure: (error: Error) => void = () => {};
    const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
    // Attach before consuming the captured prefix; the callbacks run on the same event loop.
    const fail = (): void => {
      failed ??= new Error('Authored test protocol or transport failed');
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
            if (controller.signal.aborted || failed !== undefined) throw new Error('Authored test transport stopped');
            let response: object;
            try {
              let result: unknown = null;
              if (request.method === 'case.start') {
                record(request.params, ['name', 'source']);
                if (started || string(request.params.name, 1024) !== name) invalid();
                if (request.params.source !== undefined) {
                  const source = record(request.params.source, ['file', 'line']);
                  const file = string(source.file, 255);
                  if (!file || /[\\/]/.test(file) || [...file].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !Number.isSafeInteger(source.line) || (source.line as number) < 1) invalid();
                  dispatch.setSource(`${this.language} case ${file}:${source.line as number}: `);
                }
                started = true;
              } else {
                if (!started || completed) invalid();
                if (request.method === 'case.complete') {
                  record(request.params, this.language === 'Python' ? ['outcome'] : []);
                  if (request.params.outcome !== undefined && request.params.outcome !== 'passed' && request.params.outcome !== 'skipped') invalid();
                  outcome = request.params.outcome === 'skipped' ? 'skipped' : 'passed';
                  completed = true;
                } else result = await dispatch.dispatch(request);
              }
              response = { protocol: 2, id: request.id, result };
            }
            catch (cause) {
              dispatchFailure ??= cause ?? new Error('Authored requested operation failed');
              response = { protocol: 2, id: request.id, error: { message: 'Authored requested operation failed' } };
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
      if (busy) throw new Error('Authored test exited with an unfinished operation');
      if (dispatchFailure !== undefined) throw dispatchFailure;
      if (!started || !completed) throw new Error('Authored test exited before completing its registered body');
      if (result.status !== 'exited' || result.exitCode !== 0 || result.ioError !== undefined) throw new Error('Authored test failed, exceeded its deadline, or could not clean up');
    } catch (cause) { operationFailure = cause; } finally {
      unsubscribe(); controller.abort();
      try {
        const result = await child.stop();
        if (result.ioError !== undefined) cleanupFailure = new Error('Authored test cleanup failed');
      } catch { cleanupFailure = new Error('Authored test cleanup failed'); }
      await Promise.allSettled(active);
    }
    if (operationFailure !== undefined && cleanupFailure !== undefined) throw new AggregateError([operationFailure, cleanupFailure], 'Authored test and cleanup failed');
    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (operationFailure !== undefined) throw operationFailure;
    if (failed !== undefined) throw failed;
    if (dispatchFailure !== undefined) throw dispatchFailure;
    return outcome;
  }
}
