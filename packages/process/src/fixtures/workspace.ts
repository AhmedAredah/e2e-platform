import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessError } from '../error.ts';
import { ObservedOperations } from '../internal/observed-operations.ts';
import { LocalProcessRunner, type ProcessRunner } from '../process/runner.ts';
import { ApplicationService, type ApplicationServiceOptions } from '../service/application.ts';
import type { ProcessOptions, ProcessResult, ProcessSession, RunProcessOptions } from '../types.ts';

/** Per-attempt process workspace. Children stop before temporary files are removed. */
export interface ProcessFixture {
  readonly directory: string;
  run(options: RunProcessOptions): Promise<ProcessResult>;
  start(options: ProcessOptions): Promise<ProcessSession>;
  startService(options: ApplicationServiceOptions): Promise<ApplicationService>;
}

/** Owns process operations and an isolated directory, using an injectable supervisor. */
export class ProcessWorkspace implements ProcessFixture {
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sessions = new Set<ProcessSession>();
  private readonly services = new Set<ApplicationService>();
  private readonly cleanupFailures: unknown[] = [];
  private readonly observed = new ObservedOperations();
  private disposal: Promise<void> | undefined;

  private constructor(readonly directory: string, private readonly runner: ProcessRunner) {}

  /** Creates a fresh workspace. No shared caller directories are removed at disposal. */
  static async create(runner: ProcessRunner = new LocalProcessRunner()): Promise<ProcessWorkspace> {
    return new ProcessWorkspace(await mkdtemp(join(tmpdir(), 'e2e-process-')), runner);
  }

  /** Applies the workspace's directory and cancellation without dropping caller cancellation. */
  private options<T extends ProcessOptions>(options: T): T {
    if (this.disposal) throw new Error('Process workspace has been disposed');
    return { ...options, cwd: options.cwd ?? this.directory, signal: options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal };
  }

  /** Tracks even unawaited commands so teardown cannot remove a live child's files. */
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(() => { this.pending.delete(operation); }, (cause: unknown) => {
      this.pending.delete(operation);
      if (cause instanceof ProcessError && (cause.code === 'PROCESS_CLEANUP_FAILED' || cause.result?.ioError !== undefined)) this.cleanupFailures.push(cause.result?.ioError ?? cause);
      else if (cause instanceof AggregateError) this.cleanupFailures.push(cause);
    });
    return this.observed.wrap(operation);
  }

  /** Runs a finite command in this workspace unless cwd is explicitly supplied. */
  run(options: RunProcessOptions): Promise<ProcessResult> { return this.track(this.runner.run(this.options(options))); }

  /** Starts a service in this workspace and owns it through readiness and disposal. */
  startService(options: ApplicationServiceOptions): Promise<ApplicationService> {
    return this.track(ApplicationService.start({ ...options, process: this.options(options.process) }, this).then(service => {
      this.services.add(service);
      return service;
    }));
  }

  /** Starts a long-lived child owned by this workspace. */
  start(options: ProcessOptions): Promise<ProcessSession> {
    const operation = this.runner.start(this.options(options)).then((session) => {
      this.sessions.add(session);
      void session.result.then((result) => { this.sessions.delete(session); if (result.ioError !== undefined) this.cleanupFailures.push(result.ioError); }, (cause: unknown) => { this.sessions.delete(session); this.cleanupFailures.push(cause); });
      return session;
    });
    return this.track(operation);
  }

  /** Cancels and drains all operations, stops live sessions, then removes the directory. */
  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      this.controller.abort();
      await Promise.allSettled(this.pending);
      const results = await Promise.allSettled([...this.sessions].map((session) => session.stop()));
      const failures = [...this.cleanupFailures, ...results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : result.value.ioError === undefined ? [] : [result.value.ioError])];
      if (failures.length === 0) await rm(this.directory, { recursive: true, force: true });
      const unobserved = await this.observed.failures();
      const serviceFailures: unknown[] = [];
      for (const service of this.services) {
        try { service.assertHealthy(); } catch (cause) { serviceFailures.push(cause); }
      }
      if (failures.length > 0) throw new AggregateError([...failures, ...serviceFailures, ...unobserved], 'Process workspace cleanup failed');
      if (serviceFailures.length > 0) throw new AggregateError([...serviceFailures, ...unobserved], 'Application service failed before owned shutdown');
      if (unobserved.length > 0) throw new AggregateError(unobserved, 'Unobserved process operation failed; await or handle every process operation');
    })();
    return this.disposal;
  }
}
