export interface TerminalExit {
  readonly exitCode: number;
  readonly signal?: number;
}

export interface TerminalCommand {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalSessionOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly scrollback?: number;
  /** Total raw output per session; exceeding it fails and closes the transport. */
  readonly maxOutputBytes?: number;
  /** Protects the asynchronous terminal parser from a fast producer. */
  readonly maxPendingBytes?: number;
  readonly timeoutMs?: number;
}

export interface TerminalOperation {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Visible terminal cells after VT parsing; not the raw transcript. */
export interface TerminalSnapshot extends TerminalDimensions {
  readonly lines: readonly string[];
  readonly text: string;
  readonly cursor: { readonly column: number; readonly row: number };
  readonly alternate: boolean;
  readonly title: string;
  readonly exit?: TerminalExit;
}

export type TerminalErrorCode = 'INVALID_ARGUMENT' | 'TIMEOUT' | 'ABORTED' | 'EXITED' | 'CLOSED' | 'OUTPUT_LIMIT' | 'TRANSPORT_FAILED' | 'UNSUPPORTED_KEY' | 'DEPENDENCY_MISSING';

export class TerminalError extends Error {
  readonly code: TerminalErrorCode;
  constructor(code: TerminalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TerminalError';
    this.code = code;
  }
}

export function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TerminalError('INVALID_ARGUMENT', `${name} must be an integer from 1 through ${maximum}`);
  }
  return value;
}
