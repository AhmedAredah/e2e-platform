import { setTimeout as delay } from 'node:timers/promises';
import { ProcessError } from '../error.ts';
import { LocalProcessRunner, type ProcessRunner } from '../process/runner.ts';
import type { ProcessOptions, ProcessResult, ProcessSession } from '../types.ts';

/** One readiness probe receives a bounded lifetime and the actual owned process. */
export interface ServiceReadinessContext {
  readonly session: ProcessSession;
  readonly signal: AbortSignal;
  readonly remainingMs: number;
}

/** Extend this contract for an HTTP endpoint, output marker or application-specific check. */
export abstract class ServiceReadiness {
  abstract ready(context: ServiceReadinessContext): boolean | Promise<boolean>;
}

/** A callback adapter keeps readiness policy separate from process supervision. */
export class PredicateReadiness extends ServiceReadiness {
  constructor(private readonly predicate: (context: ServiceReadinessContext) => boolean | Promise<boolean>) { super(); }
  override ready(context: ServiceReadinessContext): boolean | Promise<boolean> { return this.predicate(context); }
}

/** Readiness is separate from the optional deadline for the complete process lifetime. */
export interface ApplicationServiceOptions {
  readonly process: ProcessOptions;
  readonly readiness: ServiceReadiness;
  readonly startupTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

/** Validates timer values before any process is created. */
function positiveTimer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new TypeError(`${name} must be a positive timer duration`);
  return value;
}

/** Owns a live application after a real readiness condition, without assuming an HTTP framework. */
export class ApplicationService {
  private stopping = false;
  private failure: ProcessError | undefined;

  private constructor(readonly session: ProcessSession) {
    void session.result.then((result) => {
      if (!this.stopping && result.status !== 'stopped' && result.status !== 'aborted') {
        this.failure = new ProcessError('PROCESS_EXIT_FAILED', 'Service exited before owned shutdown', { result });
      }
    }, (cause: unknown) => { this.failure = new ProcessError('PROCESS_IO_FAILED', 'Service supervision failed', { cause }); });
  }

  /** Starts and probes one child; failure always stops and drains that owned child. */
  static async start(options: ApplicationServiceOptions, runner: ProcessRunner = new LocalProcessRunner()): Promise<ApplicationService> {
    const timeoutMs = positiveTimer(options.startupTimeoutMs ?? 30_000, 'startupTimeoutMs');
    const intervalMs = positiveTimer(options.pollIntervalMs ?? 50, 'pollIntervalMs');
    if (typeof options.readiness?.ready !== 'function') throw new TypeError('readiness must implement ServiceReadiness.ready');
    const session = await runner.start(options.process);
    const controller = new AbortController();
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    let exited: ProcessResult | undefined;
    const completion = session.result.then((result) => {
      exited = result;
      throw new ProcessError('PROCESS_EXIT_FAILED', 'Service exited before readiness', { result });
    });
    const interrupted = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ProcessError('PROCESS_TIMED_OUT', `Service readiness exceeded ${timeoutMs} ms`);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
      abort = () => {
        const error = new ProcessError('PROCESS_ABORTED', 'Service readiness was aborted');
        controller.abort(error);
        reject(error);
      };
      options.process.signal?.addEventListener('abort', abort, { once: true });
      if (options.process.signal?.aborted) abort();
    });
    try {
      await Promise.race([completion, interrupted, (async () => {
        for (;;) {
          controller.signal.throwIfAborted();
          if (exited !== undefined) throw new ProcessError('PROCESS_EXIT_FAILED', 'Service exited before readiness', { result: exited });
          if (await options.readiness.ready({ session, signal: controller.signal, remainingMs: Math.max(0, timeoutMs - (performance.now() - started)) })) {
            if (exited !== undefined) throw new ProcessError('PROCESS_EXIT_FAILED', 'Service exited before readiness', { result: exited });
            return;
          }
          await delay(intervalMs, undefined, { signal: controller.signal });
        }
      })()]);
      return new ApplicationService(session);
    } catch (cause) {
      try {
        const result = await session.stop();
        if (result.ioError !== undefined) throw result.ioError;
      } catch (cleanup) { throw new AggregateError([cause, cleanup], 'Service startup and cleanup failed', { cause: cleanup }); }
      throw cause;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort !== undefined) options.process.signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  /** Completes after exit and drained output; callers decide the expected lifetime and status. */
  get result(): Promise<ProcessResult> { return this.session.result; }

  /** A ready service must remain alive until requested shutdown; a success exit alone is insufficient. */
  assertHealthy(): void { if (this.failure !== undefined) throw this.failure; }

  /** Idempotent owned process-tree shutdown with its completed result. */
  stop(): Promise<ProcessResult> { this.stopping = true; return this.session.stop(); }
}
