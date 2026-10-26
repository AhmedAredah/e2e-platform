/** A binary-safe bounded prefix of one output stream. Disk logs retain the full stream. */
export interface ProcessCapture {
  readonly bytes: Buffer;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

/** The reason a supervised process finished; a requested stop is not an application crash. */
export type ProcessStatus = 'exited' | 'signaled' | 'timed-out' | 'aborted' | 'stopped';

/** A completed subprocess, including unsuccessful exits. */
export interface ProcessResult {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly pid: number;
  readonly status: ProcessStatus;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly stdout: ProcessCapture;
  readonly stderr: ProcessCapture;
  /** Output/input/logging failures are independent of the application's exit status. */
  readonly ioError?: Error;
}

/** Execution options. Commands are always launched directly, never interpreted by a shell. */
export interface ProcessOptions {
  readonly executable: string;
  readonly args?: readonly string[];
  /** Defaults to the caller's working directory, resolved once before launch. */
  readonly cwd?: string;
  /** Overrides inherited variables; undefined removes one. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Set false to supply only env, without inheriting the controller's environment. */
  readonly inheritEnv?: boolean;
  /** A wall-clock deadline for the entire process lifetime; omitted means no deadline. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Maximum captured bytes per stream, default 1 MiB. Zero keeps counters only. */
  readonly maxOutputBytes?: number;
  /** Full binary logs, created exclusively; existing files are never overwritten. */
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  /** POSIX graceful shutdown budget before SIGKILL, default 500 ms. */
  readonly killGraceMs?: number;
  /** Bounds inherited pipes after the root exits, default 5000 ms. Expiry fails cleanup. */
  readonly drainTimeoutMs?: number;
  /** Initial input. When supplied, startProcess writes it and closes stdin. */
  readonly stdin?: string | Uint8Array;
}

/** Options for a finite command with an asserted exit-code contract. */
export interface RunProcessOptions extends ProcessOptions {
  readonly expectedExitCodes?: readonly number[];
}

/** Streaming output notification. Treat bytes as immutable. */
export interface ProcessOutput {
  readonly stream: 'stdout' | 'stderr';
  readonly bytes: Buffer;
}

/** A live child. result resolves after exit and all output/log files have drained. */
export interface ProcessSession {
  readonly pid: number;
  readonly result: Promise<ProcessResult>;
  readonly stdout: ProcessCapture;
  readonly stderr: ProcessCapture;
  /** Writes binary or UTF-8 input and observes stream backpressure. */
  write(data: string | Uint8Array): Promise<void>;
  /** Sends EOF, idempotently. */
  closeInput(): Promise<void>;
  /** Terminates the owned process tree, then waits for output and cleanup. */
  stop(): Promise<ProcessResult>;
  /** Subscribes to future chunks; inspect stdout/stderr for already received output. */
  onOutput(listener: (event: ProcessOutput) => void): () => void;
}

export type ProcessErrorCode = 'PROCESS_SPAWN_FAILED' | 'PROCESS_EXIT_FAILED' | 'PROCESS_SIGNALED' | 'PROCESS_TIMED_OUT' | 'PROCESS_ABORTED' | 'PROCESS_IO_FAILED' | 'PROCESS_STDIN_CLOSED' | 'PROCESS_CLEANUP_FAILED';
