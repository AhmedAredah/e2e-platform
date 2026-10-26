import { ProcessError } from '../error.ts';
import type { ProcessOptions, ProcessResult, ProcessSession, RunProcessOptions } from '../types.ts';
import { startLocalProcess } from './local.ts';

/**
 * Supervisor extension point. Subclasses provide process launch/session ownership;
 * finite-command validation and exit contracts remain identical across supervisors.
 */
export abstract class ProcessRunner {
  /** Starts an owned session. A backend must clean up on deadline, abort and stop. */
  abstract start(options: ProcessOptions): Promise<ProcessSession>;

  /** Runs a finite command and enforces its exit-code contract after draining output. */
  async run(options: RunProcessOptions): Promise<ProcessResult> {
    const expected = options.expectedExitCodes ?? [0];
    if (expected.length === 0 || expected.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 4_294_967_295)) throw new TypeError('expectedExitCodes must be a nonempty list of unsigned exit codes');
    const session = await this.start(options);
    // A completed child is authoritative even if a supervisor's EOF callback
    // is lost when the child closes its input endpoint during startup.
    let result: ProcessResult;
    try {
      if (options.stdin === undefined) await Promise.race([session.closeInput(), session.result]);
      result = await session.result;
    } catch (cause) {
      try {
        const stopped = await session.stop();
        if (stopped.ioError !== undefined) throw stopped.ioError;
      } catch (cleanup) { throw new AggregateError([cause, cleanup], 'Process operation and cleanup failed', { cause: cleanup }); }
      throw cause;
    }
    const failure = (code: ConstructorParameters<typeof ProcessError>[0], message: string): never => { throw new ProcessError(code, message, { result, ...(result.ioError === undefined ? {} : { cause: result.ioError }) }); };
    if (result.status === 'timed-out') failure('PROCESS_TIMED_OUT', `Process exceeded ${options.timeoutMs} ms`);
    if (result.status === 'aborted') failure('PROCESS_ABORTED', 'Process was aborted');
    if (result.ioError) failure(result.ioError instanceof ProcessError ? result.ioError.code : 'PROCESS_IO_FAILED', 'Process I/O or cleanup failed');
    if (result.status === 'signaled') failure('PROCESS_SIGNALED', `Process terminated by ${result.signal}`);
    if (result.status === 'stopped') failure('PROCESS_EXIT_FAILED', 'Finite process was stopped before completion');
    if (result.exitCode === null || !expected.includes(result.exitCode)) failure('PROCESS_EXIT_FAILED', `Unexpected process exit code ${result.exitCode}; expected ${expected.join(', ')}`);
    return result;
  }
}

/** Local OS supervisor with bounded pipes, full binary logs and owned tree cleanup. */
export class LocalProcessRunner extends ProcessRunner {
  /** Launches directly without a shell. */
  override start(options: ProcessOptions): Promise<ProcessSession> { return startLocalProcess(options); }
}

const local = new LocalProcessRunner();

/** Starts a local session using the default LocalProcessRunner. */
export function startProcess(options: ProcessOptions): Promise<ProcessSession> { return local.start(options); }

/** Runs a local finite command using the default LocalProcessRunner. */
export function runProcess(options: RunProcessOptions): Promise<ProcessResult> { return local.run(options); }
