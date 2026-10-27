import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, type FixtureContext } from '@e2e-platform/core';
import { ProcessError } from './error.ts';
import { ProcessWorkspace, type ProcessFixture } from './fixtures/workspace.ts';
import { ObservedOperations } from './internal/observed-operations.ts';
import type { ProcessRunner } from './process/runner.ts';
import type { ProcessOptions, ProcessResult } from './types.ts';

export { expect } from '@e2e-platform/core';

export type { ProcessFixture } from './fixtures/workspace.ts';

export interface ProcessTestOptions {
  /** The supervisor still owns its session/cleanup contract; the fixture owns attempt lifetime. */
  readonly runner?: ProcessRunner;
}

/** Adds the running phase's cancellation without capturing a stale teardown signal. */
function phaseOptions<T extends ProcessOptions>(options: T, context: FixtureContext): T {
  return { ...options, signal: options.signal === undefined ? context.signal : AbortSignal.any([options.signal, context.signal]) };
}

/** Records bounded, content-free process diagnostics; output and arguments stay caller-owned. */
async function diagnostics(context: FixtureContext, result: ProcessResult): Promise<void> {
  const relative = `process-${randomUUID()}.json`;
  await writeFile(join(context.artifactsDirectory, relative), `${JSON.stringify({
    schemaVersion: 1,
    status: result.status, exitCode: result.exitCode, signal: result.signal,
    durationMs: result.durationMs,
    stdout: { totalBytes: result.stdout.totalBytes, capturedBytes: result.stdout.bytes.length, truncated: result.stdout.truncated },
    stderr: { totalBytes: result.stderr.totalBytes, capturedBytes: result.stderr.bytes.length, truncated: result.stderr.truncated },
    ioFailed: result.ioError !== undefined,
  }, null, 2)}\n`, { flag: 'wx' });
  context.attachArtifact('log', relative);
}

/** Creates a recorded process fixture with an explicitly selected supervisor. */
export function createProcessTest(configuration: ProcessTestOptions = {}): ReturnType<typeof base.extend<{ processes: ProcessFixture }>> {
  return base.extend<{ processes: ProcessFixture }>({
    processes: async (_fixtures, use, context) => {
      const workspace = await ProcessWorkspace.create(configuration.runner);
      const observed = new ObservedOperations();
      const recorded = context.fixture<ProcessFixture>('processes', {
        directory: workspace.directory,
        run: async (options) => {
          let result: ProcessResult;
          try { result = await workspace.run(phaseOptions(options, context)); }
          catch (cause) {
            if (cause instanceof ProcessError && cause.result !== undefined) await diagnostics(context, cause.result);
            throw cause;
          }
          await diagnostics(context, result);
          return result;
        },
        start: (options) => workspace.start(phaseOptions(options, context)),
        startService: (options) => workspace.startService({ ...options, process: phaseOptions(options.process, context) }),
      }, {
        run: { kind: 'resource', label: () => 'Run process', timeout: false },
        start: { kind: 'resource', label: () => 'Start process', timeout: false },
        startService: { kind: 'resource', label: () => 'Start service and await readiness', timeout: false },
      });
      let bodyFailed = false;
      let bodyFailure: unknown;
      try {
        await use({
          directory: workspace.directory,
          run: options => observed.wrap(recorded.run(options)),
          start: options => observed.wrap(recorded.start(options)),
          startService: options => observed.wrap(recorded.startService(options)),
        });
      } catch (cause) { bodyFailed = true; bodyFailure = cause; }
      let cleanup: unknown;
      try { await workspace.dispose(); } catch (cause) { cleanup = cause; }
      const unobserved = await observed.failures();
      const failures = [...(bodyFailed ? [bodyFailure] : []), ...(cleanup === undefined ? [] : [cleanup]), ...unobserved];
      if (failures.length > 1) throw new AggregateError(failures, 'Process fixture failed; await or handle every process operation');
      if (bodyFailed) throw bodyFailure;
      if (cleanup !== undefined) throw cleanup;
      if (unobserved.length > 0) throw new AggregateError(unobserved, 'Unobserved process operation failed; await or handle every process operation');
    },
  });
}

/** e2e test with an isolated subprocess workspace and automatic process-tree cleanup. */
export const test = createProcessTest();
