import type { ProcessOptions } from '@e2e-platform/process';
import type { RequestContext } from '../transport/native-transport.ts';

/**
 * Owned application/sidecar acquisition. options.signal owns the attempt;
 * context limits acquisition only. A factory must honor context cancellation,
 * return its owned ProcessSession, and clean up anything it acquires before
 * throwing. It must never return an unowned external service as a process.
 */
export interface NativeProcessLaunch {
  readonly options: ProcessOptions;
  readonly context: RequestContext;
}
