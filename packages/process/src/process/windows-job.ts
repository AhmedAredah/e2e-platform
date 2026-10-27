import { spawn } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BoundedCapture } from '../capture/bounded.ts';
import { ProcessError } from '../error.ts';
import type { ProcessOptions, ProcessOutput, ProcessResult, ProcessSession } from '../types.ts';
import { ProcessRunner } from './runner.ts';

const FRAME_LIMIT = 128 * 1024;
const OUTPUT_LIMIT = 16 * 1024;
const INPUT_CHUNK = 64 * 1024;

export interface WindowsJobRunnerOptions {
  /** Absolute path to the separately installed supervisor or its explicit dotnet host. */
  readonly executable: string;
  /** For example, the absolute supervisor DLL path when executable is dotnet. */
  readonly args?: readonly string[];
  readonly launchTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

/** Validates a platform path without depending on the controller's test-host platform. */
function absolute(value: string): boolean { return isAbsolute(value) || win32.isAbsolute(value); }

/** Keeps all timers inside Node's supported range. */
function duration(value: number, name: string, maximum = 2_147_483_647): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError(`${name} must be a nonnegative timer duration no greater than ${maximum}`);
  return value;
}

/** Produces one case-insensitive Windows environment without inherited libuv fallback. */
function environment(options: ProcessOptions): Record<string, string> {
  const result: Record<string, string> = {};
  if (options.inheritEnv !== false) {
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) result[key.toUpperCase()] = value;
  } else {
    const systemRoot = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1];
    if (systemRoot !== undefined) result.SYSTEMROOT = systemRoot;
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (key === '' || key.includes('=') || key.includes('\0') || value?.includes('\0')) throw new TypeError('Invalid process environment');
    if (value === undefined) delete result[key.toUpperCase()];
    else result[key.toUpperCase()] = value;
  }
  return result;
}

/** Writes all bytes while preserving file backpressure. */
async function writeLog(handle: FileHandle | undefined, bytes: Buffer): Promise<void> {
  if (handle === undefined) return;
  for (let offset = 0; offset < bytes.length;) {
    const result = await handle.write(bytes, offset, bytes.length - offset);
    if (result.bytesWritten === 0) throw new ProcessError('PROCESS_IO_FAILED', 'Process log made no progress');
    offset += result.bytesWritten;
  }
}

/** Resolves only after the helper's Job Object and output-drain acknowledgement. */
export class WindowsJobProcessRunner extends ProcessRunner {
  private readonly options: Required<WindowsJobRunnerOptions>;

  constructor(options: WindowsJobRunnerOptions) {
    super();
    if (typeof options.executable !== 'string' || !absolute(options.executable) || options.executable.includes('\0')) throw new TypeError('Supervisor executable must be an absolute path');
    const args = [...options.args ?? []];
    if (args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('Invalid supervisor arguments');
    this.options = {
      executable: options.executable, args,
      launchTimeoutMs: duration(options.launchTimeoutMs ?? 30_000, 'launchTimeoutMs'),
      shutdownTimeoutMs: duration(options.shutdownTimeoutMs ?? 5000, 'shutdownTimeoutMs'),
    };
  }

  /** Launches through the explicitly selected helper; an unavailable helper never falls back. */
  override async start(options: ProcessOptions): Promise<ProcessSession> {
    if (typeof options.executable !== 'string' || !absolute(options.executable) || options.executable.includes('\0')) throw new TypeError('Job-supervised executable must be an absolute path');
    const args = [...options.args ?? []];
    if (args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('Invalid process arguments');
    const limit = options.maxOutputBytes ?? 1_048_576;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('maxOutputBytes must be a nonnegative safe integer');
    if (options.timeoutMs !== undefined) duration(options.timeoutMs, 'timeoutMs');
    if (options.killGraceMs !== undefined) duration(options.killGraceMs, 'killGraceMs');
    const drainTimeoutMs = duration(options.drainTimeoutMs ?? 5000, 'drainTimeoutMs', 30_000);
    if (options.signal?.aborted) throw new ProcessError('PROCESS_ABORTED', 'Process launch was aborted');
    const cwd = resolve(options.cwd ?? process.cwd());
    const launch = JSON.stringify({ kind: 'launch', version: 1, id: 1, executable: options.executable, args, cwd, env: environment(options), parentPid: process.pid, drainTimeoutMs });
    if (Buffer.byteLength(launch) > FRAME_LIMIT) throw new TypeError('Process launch exceeds the supervisor frame limit');
    const stdoutPath = options.stdoutPath === undefined ? undefined : resolve(cwd, options.stdoutPath);
    const stderrPath = options.stderrPath === undefined ? undefined : resolve(cwd, options.stderrPath);
    if (stdoutPath !== undefined && stdoutPath === stderrPath) throw new TypeError('stdoutPath and stderrPath must differ');
    const logs: (FileHandle | undefined)[] = [];
    try {
      logs.push(stdoutPath === undefined ? undefined : await open(stdoutPath, 'wx'));
      logs.push(stderrPath === undefined ? undefined : await open(stderrPath, 'wx'));
    } catch {
      await Promise.allSettled(logs.map(log => log?.close()));
      throw new ProcessError('PROCESS_IO_FAILED', 'Could not create process output logs');
    }

    const startedAt = performance.now();
    let helper: ReturnType<typeof spawn> & { stdin: import('node:stream').Writable; stdout: import('node:stream').Readable; stderr: import('node:stream').Readable };
    try { helper = spawn(this.options.executable, this.options.args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch {
      await Promise.allSettled(logs.map(log => log?.close()));
      throw new ProcessError('PROCESS_SPAWN_FAILED', 'Could not launch the selected Windows supervisor');
    }
    const stdout = new BoundedCapture(limit);
    const stderr = new BoundedCapture(limit);
    const listeners = new Set<(output: ProcessOutput) => void>();
    const acknowledgements = new Map<number, { kind: string; resolve(): void; reject(cause: unknown): void }>();
    let nextId = 2;
    let pid: number | undefined;
    let rootExited = false;
    let rootExitCode: number | undefined;
    let final: { exitCode: number; stopped: boolean } | undefined;
    let reason: 'timed-out' | 'aborted' | 'stopped' | undefined;
    let ioError: Error | undefined;
    let helperSpawned = false;
    let helperClosed = false;
    let stopping = false;
    let eof: Promise<void> | undefined;
    let writing: Promise<void> | undefined;
    let initialInput: Promise<void> | undefined;
    let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let acceptStarted!: () => void;
    let rejectStarted!: (cause: unknown) => void;
    const started = new Promise<void>((accept, reject) => { acceptStarted = accept; rejectStarted = reject; });
    let finishHelper!: (code: number | null) => void;
    const helperCompletion = new Promise<number | null>(accept => { finishHelper = accept; });

    /** A failed helper is never interpreted as confirmed target cleanup. */
    const forceHelper = (): void => {
      ioError ??= new ProcessError('PROCESS_CLEANUP_FAILED', 'Supervisor did not confirm process cleanup');
      helper.stdin.destroy();
      if (!helperClosed) {
        try { helper.kill('SIGKILL'); }
        catch { ioError = new ProcessError('PROCESS_CLEANUP_FAILED', 'Could not terminate the selected Windows supervisor'); }
        if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
        shutdownTimer = setTimeout(() => {
          if (helperClosed) return;
          // Return an explicit cleanup failure even if the OS never acknowledges helper exit.
          helperClosed = true;
          helper.stdout.destroy();
          helper.stderr.destroy();
          helper.unref();
          finishHelper(null);
        }, 1000);
      }
    };

    /** Writes a bounded control frame and observes the pipe write callback. */
    const writeFrame = (frame: string): Promise<void> => new Promise((accept, reject) => {
      if (helperClosed || helper.stdin.destroyed || helper.stdin.writableEnded) { reject(new ProcessError('PROCESS_STDIN_CLOSED', 'Supervisor input is closed')); return; }
      helper.stdin.write(`${frame}\n`, (error) => { if (error) reject(new ProcessError('PROCESS_IO_FAILED', 'Supervisor control write failed')); else accept(); });
    });

    /** Acknowledgements bound target-input buffering to one submitted chunk. */
    const command = (kind: 'stdin' | 'eof' | 'stop', data?: string): Promise<void> => {
      const id = nextId++;
      const acknowledgement = new Promise<void>((accept, reject) => { acknowledgements.set(id, { kind, resolve: accept, reject }); });
      void writeFrame(JSON.stringify({ kind, id, ...(data === undefined ? {} : { data }) })).catch(cause => {
        acknowledgements.get(id)?.reject(cause);
        acknowledgements.delete(id);
      });
      return acknowledgement;
    };

    /** Stops the entire owned job; a bounded fallback closes its kill-on-close owner. */
    const requestStop = (status: 'timed-out' | 'aborted' | 'stopped'): void => {
      if (!rootExited) reason ??= status;
      if (helperClosed || stopping) return;
      stopping = true;
      void command('stop').catch(() => undefined);
      shutdownTimer = setTimeout(forceHelper, this.options.shutdownTimeoutMs);
    };

    /** Protocol failures retain a fixed diagnostic without echoing a received frame. */
    const fail = (error: ProcessError): void => {
      ioError ??= error;
      if (pid === undefined) rejectStarted(error);
      requestStop('stopped');
    };

    const launchTimer = setTimeout(() => {
      const error = new ProcessError('PROCESS_TIMED_OUT', 'Supervisor launch exceeded its deadline');
      rejectStarted(error);
      requestStop('timed-out');
    }, this.options.launchTimeoutMs);
    if (options.timeoutMs !== undefined) lifetimeTimer = setTimeout(() => {
      rejectStarted(new ProcessError('PROCESS_TIMED_OUT', 'Process exceeded its deadline'));
      requestStop('timed-out');
    }, options.timeoutMs);
    const abort = (): void => {
      rejectStarted(new ProcessError('PROCESS_ABORTED', 'Process was aborted'));
      requestStop('aborted');
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    helper.once('spawn', () => { helperSpawned = true; });
    helper.on('error', () => { fail(new ProcessError('PROCESS_SPAWN_FAILED', 'Could not launch the selected Windows supervisor')); });
    helper.stdin.on('error', () => { if (!stopping && final === undefined) fail(new ProcessError('PROCESS_IO_FAILED', 'Supervisor input failed')); });
    helper.once('close', (code) => {
      helperClosed = true;
      if (pid === undefined) rejectStarted(new ProcessError('PROCESS_SPAWN_FAILED', 'Supervisor exited before target startup'));
      finishHelper(code);
    });

    /** Accepts only documented protocol fields with bounded binary output. */
    const frame = async (line: Buffer): Promise<void> => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as Record<string, unknown>; }
      catch { throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an invalid frame'); }
      if (event === null || typeof event !== 'object' || Array.isArray(event) || typeof event.kind !== 'string') throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an invalid event');
      const keys: Record<string, readonly string[]> = { started: ['kind', 'id', 'pid'], output: ['kind', 'stream', 'data'], ack: ['kind', 'id'], rootExit: ['kind', 'exitCode'], exit: ['kind', 'exitCode', 'stopped', 'cleanup'], error: ['kind', 'code', 'message'] };
      const allowed = keys[event.kind];
      if (allowed === undefined || Object.keys(event).some(key => !allowed.includes(key)) || (final !== undefined && event.kind !== 'ack')) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an unexpected event');
      const exitCode = (): number => {
        if (!Number.isSafeInteger(event.exitCode) || (event.exitCode as number) < 0 || (event.exitCode as number) > 4_294_967_295) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an invalid exit status');
        return event.exitCode as number;
      };
      if (event.kind === 'started') {
        if (pid !== undefined || event.id !== 1 || !Number.isSafeInteger(event.pid) || (event.pid as number) <= 1) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted invalid startup acknowledgement');
        pid = event.pid as number;
        clearTimeout(launchTimer);
        acceptStarted();
      } else if (event.kind === 'output') {
        if (pid === undefined || (event.stream !== 'stdout' && event.stream !== 'stderr') || typeof event.data !== 'string' || event.data.length > 4 * Math.ceil(OUTPUT_LIMIT / 3)) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted invalid output');
        const bytes = Buffer.from(event.data, 'base64');
        if (bytes.length > OUTPUT_LIMIT || bytes.toString('base64') !== event.data) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted invalid binary output');
        const capture = event.stream === 'stdout' ? stdout : stderr;
        capture.append(bytes);
        for (const listener of listeners) listener({ stream: event.stream, bytes });
        await writeLog(logs[event.stream === 'stdout' ? 0 : 1], bytes);
      } else if (event.kind === 'ack') {
        if (!Number.isSafeInteger(event.id) || !acknowledgements.has(event.id as number)) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an unknown acknowledgement');
        acknowledgements.get(event.id as number)!.resolve();
        acknowledgements.delete(event.id as number);
      } else if (event.kind === 'rootExit') {
        if (pid === undefined || rootExited) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an unexpected root exit');
        rootExitCode = exitCode();
        rootExited = true;
        if (lifetimeTimer !== undefined) clearTimeout(lifetimeTimer);
        drainTimer = setTimeout(forceHelper, drainTimeoutMs + this.options.shutdownTimeoutMs);
      } else if (event.kind === 'exit') {
        if (pid === undefined || !rootExited || event.cleanup !== true || typeof event.stopped !== 'boolean') throw new ProcessError('PROCESS_CLEANUP_FAILED', 'Supervisor did not confirm job and stream cleanup');
        const code = exitCode();
        if (code !== rootExitCode) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor exit statuses disagree');
        final = { exitCode: code, stopped: event.stopped };
        helper.stdin.end();
        if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
        shutdownTimer = setTimeout(forceHelper, this.options.shutdownTimeoutMs);
      } else {
        const codes = { INVALID_REQUEST: 'PROCESS_SPAWN_FAILED', LAUNCH_FAILED: 'PROCESS_SPAWN_FAILED', STDIN_CLOSED: 'PROCESS_STDIN_CLOSED', IO_FAILED: 'PROCESS_IO_FAILED', CLEANUP_FAILED: 'PROCESS_CLEANUP_FAILED' } as const;
        if (typeof event.code !== 'string' || !Object.hasOwn(codes, event.code) || typeof event.message !== 'string') throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor emitted an invalid error');
        fail(new ProcessError(codes[event.code as keyof typeof codes], 'Windows supervisor reported an operation failure'));
      }
    };

    const output = (async () => {
      let pending = Buffer.alloc(0);
      try {
        for await (const chunk of helper.stdout) {
          const bytes = chunk as Buffer;
          let offset = 0;
          for (;;) {
            const newline = bytes.indexOf(10, offset);
            const tail = bytes.subarray(offset, newline === -1 ? bytes.length : newline);
            if (pending.length + tail.length > FRAME_LIMIT) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor frame exceeded its byte limit');
            pending = Buffer.concat([pending, tail]);
            if (newline === -1) break;
            if (pending.at(-1) === 13) pending = pending.subarray(0, -1);
            await frame(pending);
            pending = Buffer.alloc(0);
            offset = newline + 1;
          }
        }
        if (pending.length !== 0) throw new ProcessError('PROCESS_IO_FAILED', 'Supervisor ended an incomplete frame');
      } catch (cause) { fail(cause instanceof ProcessError ? cause : new ProcessError('PROCESS_IO_FAILED', 'Supervisor output or log failed')); }
    })();
    const diagnostics = (async () => {
      try { for await (const chunk of helper.stderr) { void chunk; /* Drain without publishing helper text. */ } }
      catch { fail(new ProcessError('PROCESS_IO_FAILED', 'Supervisor diagnostic stream failed')); }
    })();
    const result = (async (): Promise<ProcessResult> => {
      const code = await helperCompletion;
      await Promise.all([output, diagnostics]);
      for (const pending of acknowledgements.values()) {
        if (pending.kind === 'eof' && final !== undefined) pending.resolve();
        else pending.reject(new ProcessError('PROCESS_STDIN_CLOSED', 'Process exited before input acknowledgement'));
      }
      acknowledgements.clear();
      await initialInput;
      if (code !== 0 || final === undefined) ioError ??= new ProcessError('PROCESS_CLEANUP_FAILED', 'Supervisor exited without confirmed cleanup');
      const closed = await Promise.allSettled(logs.map(log => log?.close()));
      if (closed.some(entry => entry.status === 'rejected')) ioError ??= new ProcessError('PROCESS_IO_FAILED', 'Could not close process output logs');
      clearTimeout(launchTimer);
      for (const timer of [lifetimeTimer, drainTimer, shutdownTimer]) if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      listeners.clear();
      return { executable: options.executable, args, cwd, pid: pid ?? 0,
        status: reason ?? (final?.stopped ? 'stopped' : 'exited'), exitCode: final?.exitCode ?? null, signal: null,
        durationMs: performance.now() - startedAt, stdout: stdout.snapshot(), stderr: stderr.snapshot(),
        ...(ioError === undefined ? {} : { ioError }),
      };
    })();
    void writeFrame(launch).catch(() => { fail(new ProcessError('PROCESS_SPAWN_FAILED', 'Could not configure the selected Windows supervisor')); });
    try { await started; }
    catch (cause) {
      requestStop(reason ?? 'stopped');
      const completed = await result;
      if (helperSpawned) {
        throw new ProcessError(cause instanceof ProcessError ? cause.code : 'PROCESS_SPAWN_FAILED', 'Windows supervisor startup failed', { cause, result: completed });
      }
      throw cause;
    }

    const session: ProcessSession = {
      pid: pid!, result,
      get stdout() { return stdout.snapshot(); },
      get stderr() { return stderr.snapshot(); },
      write(data) {
        if (writing !== undefined) return Promise.reject(new ProcessError('PROCESS_IO_FAILED', 'Await the previous input write before sending more data'));
        if (eof !== undefined || rootExited || helperClosed) return Promise.reject(new ProcessError('PROCESS_STDIN_CLOSED', 'Process stdin is closed'));
        const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const pending = (async () => {
          try {
            for (let offset = 0; offset < bytes.length; offset += INPUT_CHUNK) await command('stdin', bytes.subarray(offset, offset + INPUT_CHUNK).toString('base64'));
          } catch (cause) {
            if (reason === undefined) ioError ??= cause instanceof Error ? cause : new ProcessError('PROCESS_IO_FAILED', 'Process input failed');
            throw cause;
          }
        })().finally(() => { if (writing === pending) writing = undefined; });
        writing = pending;
        return pending;
      },
      closeInput() {
        eof ??= (async () => { await writing; if (!rootExited && !helperClosed) await command('eof'); })();
        return eof;
      },
      stop() { requestStop('stopped'); return result; },
      onOutput(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    if (options.stdin !== undefined) initialInput = session.write(options.stdin).then(() => session.closeInput()).catch(cause => {
      if (reason === undefined) ioError ??= cause instanceof Error ? cause : new ProcessError('PROCESS_IO_FAILED', 'Initial process input failed');
      requestStop('stopped');
    });
    return session;
  }
}
