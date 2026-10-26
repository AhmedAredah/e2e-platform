import type { ProcessErrorCode, ProcessResult } from './types.ts';

/** A process contract or infrastructure failure, with completed output when available. */
export class ProcessError extends Error {
  readonly code: ProcessErrorCode;
  readonly result: ProcessResult | undefined;

  constructor(code: ProcessErrorCode, message: string, options: { result?: ProcessResult; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProcessError';
    this.code = code;
    this.result = options.result;
  }
}
