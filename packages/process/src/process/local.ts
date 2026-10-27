import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import { BoundedCapture } from '../capture/bounded.ts';
import { ProcessError } from '../error.ts';
import { terminateProcessTree } from '../tree.ts';
import type { ProcessOptions, ProcessOutput, ProcessResult, ProcessSession, ProcessStatus } from '../types.ts';

/** Validates durations before creating files or starting a process. */
function duration(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 2_147_483_647)) {
    throw new TypeError(`${name} must be a finite nonnegative timer duration`);
  }
}

/** Makes a fresh environment and gives Windows variable overrides case-insensitive semantics. */
function environment(options: ProcessOptions): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = options.inheritEnv === false ? {} : { ...process.env };
  const overrides = new Set(Object.keys(options.env ?? {}).map((key) => key.toUpperCase()));
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (process.platform === 'win32') {
      for (const existing of Object.keys(result)) if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
    }
    result[key] = value;
  }
  // Node copies coverage settings unless the supplied environment owns the key.
  const coverageKey = Object.keys(result).find((key) => process.platform === 'win32' ? key.toUpperCase() === 'NODE_V8_COVERAGE' : key === 'NODE_V8_COVERAGE');
  if (coverageKey !== undefined && coverageKey !== 'NODE_V8_COVERAGE') {
    result.NODE_V8_COVERAGE = result[coverageKey];
    delete result[coverageKey];
  } else if (coverageKey === undefined && options.inheritEnv === false) {
    result.NODE_V8_COVERAGE = undefined;
  }
  if (process.platform === 'win32') {
    // libuv restores omitted bootstrap variables from the controller. Empty
    // values prevent that fallback; SystemRoot remains available for Winsock.
    const keys = new Map(Object.keys(result).map((key) => [key.toUpperCase(), key]));
    const systemRoot = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1] ?? '';
    for (const name of ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR']) {
      const key = keys.get(name);
      if (key !== undefined && result[key] !== undefined) continue;
      if (key !== undefined) delete result[key];
      result[name] = name === 'SYSTEMROOT' && options.inheritEnv === false && !overrides.has(name) ? systemRoot : '';
    }
  }
  return result;
}

/** Closes all log handles, retaining the first error without skipping another handle. */
async function closeLogs(handles: readonly (FileHandle | undefined)[]): Promise<Error | undefined> {
  const results = await Promise.allSettled(handles.map((handle) => handle?.close()));
  const failed = results.find((result) => result.status === 'rejected');
  return failed?.status === 'rejected' ? asError(failed.reason) : undefined;
}

/** Normalizes host failures without discarding Error causes. */
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }

/**
 * Starts a directly executed child with independent, continuously drained output streams.
 * The returned session owns the process tree. Always await result or call stop at teardown.
 */
export async function startLocalProcess(options: ProcessOptions): Promise<ProcessSession> {
  if (typeof options.executable !== 'string' || options.executable.length === 0 || options.executable.includes('\0')) throw new TypeError('executable must be a nonempty path or command name');
  const args = [...(options.args ?? [])];
  if (args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('args must contain strings without NUL characters');
  const limit = options.maxOutputBytes ?? 1_048_576;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('maxOutputBytes must be a nonnegative safe integer');
  duration(options.timeoutMs, 'timeoutMs');
  duration(options.killGraceMs, 'killGraceMs');
  duration(options.drainTimeoutMs, 'drainTimeoutMs');
  if (options.signal?.aborted) throw new ProcessError('PROCESS_ABORTED', 'Process launch was aborted', { cause: options.signal.reason });
  const cwd = resolve(options.cwd ?? process.cwd());
  const stdoutPath = options.stdoutPath === undefined ? undefined : resolve(cwd, options.stdoutPath);
  const stderrPath = options.stderrPath === undefined ? undefined : resolve(cwd, options.stderrPath);
  if (stdoutPath !== undefined && stdoutPath === stderrPath) throw new TypeError('stdoutPath and stderrPath must be different files');
  let stdoutLog: FileHandle | undefined;
  let stderrLog: FileHandle | undefined;
  try {
    if (stdoutPath !== undefined) stdoutLog = await open(stdoutPath, 'wx');
    if (stderrPath !== undefined) stderrLog = await open(stderrPath, 'wx');
  } catch (cause) {
    await closeLogs([stdoutLog, stderrLog]);
    throw new ProcessError('PROCESS_IO_FAILED', 'Could not create process output logs', { cause });
  }

  const started = performance.now();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(options.executable, args, { cwd, env: environment(options), shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise<void>((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
  } catch (cause) {
    await closeLogs([stdoutLog, stderrLog]);
    throw new ProcessError('PROCESS_SPAWN_FAILED', `Could not launch ${options.executable}`, { cause });
  }
  const pid = child.pid!;
  const stdout = new BoundedCapture(limit);
  const stderr = new BoundedCapture(limit);
  const listeners = new Set<(event: ProcessOutput) => void>();
  let reason: 'timed-out' | 'aborted' | 'stopped' | undefined;
  let ioError: Error | undefined;
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let initialInput: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let inputWasWritten = false;

  /** Begins one idempotent cleanup even when cancellation and the deadline race. */
  function stopTree(): Promise<void> {
    cleanup ??= terminateProcessTree(pid, { graceMs: options.killGraceMs ?? 500 }).catch((error: unknown) => {
      ioError ??= asError(error);
      if (!exited) {
        try { child.kill('SIGKILL'); }
        catch (fallback) { ioError ??= asError(fallback); }
      }
    });
    return cleanup;
  }

  /** Records the first termination trigger; natural exit keeps its own verdict. */
  function requestStop(status: 'timed-out' | 'aborted' | 'stopped'): void {
    if (exited) return;
    reason ??= status;
    child.stdin.destroy();
    void stopTree();
  }

  /** Reads one stream to EOF while honoring disk backpressure and capture limits. */
  async function drain(stream: Readable, name: 'stdout' | 'stderr', capture: BoundedCapture, log: FileHandle | undefined): Promise<void> {
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        capture.append(bytes);
        for (const listener of listeners) listener({ stream: name, bytes });
        if (log) {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await log.write(bytes, offset, bytes.length - offset);
            if (bytesWritten === 0) throw new Error(`No progress writing ${name} log`);
            offset += bytesWritten;
          }
        }
      }
    } catch (error) {
      ioError ??= asError(error);
      requestStop('stopped');
    }
  }

  const streams = [drain(child.stdout, 'stdout', stdout, stdoutLog), drain(child.stderr, 'stderr', stderr, stderrLog)];
  child.on('error', (error) => { ioError ??= error; requestStop('stopped'); });
  child.stdin.on('error', (error) => { if (reason === undefined && inputWasWritten) ioError ??= error; });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept) => {
    child.once('exit', () => {
      exited = true;
      if (timer) clearTimeout(timer);
      if (process.platform !== 'win32') void stopTree();
      drainTimer = setTimeout(() => {
        ioError ??= new ProcessError('PROCESS_CLEANUP_FAILED', 'Inherited output pipes did not close after process exit');
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }, options.drainTimeoutMs ?? 5000);
    });
    child.once('close', (code, signal) => { if (drainTimer) clearTimeout(drainTimer); accept({ code, signal }); });
  });
  const abort = () => requestStop('aborted');
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) requestStop('aborted');
  if (options.timeoutMs !== undefined) timer = setTimeout(() => requestStop('timed-out'), Math.max(0, options.timeoutMs - (performance.now() - started)));

  const result = (async (): Promise<ProcessResult> => {
    const completion = await exit;
    await initialInput;
    await Promise.all(streams);
    await cleanup;
    const logError = await closeLogs([stdoutLog, stderrLog]);
    ioError ??= logError;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    listeners.clear();
    const status: ProcessStatus = reason ?? (completion.signal === null ? 'exited' : 'signaled');
    return { executable: options.executable, args, cwd, pid, status, exitCode: completion.code, signal: completion.signal, durationMs: performance.now() - started, stdout: stdout.snapshot(), stderr: stderr.snapshot(), ...(ioError === undefined ? {} : { ioError }) };
  })();

  const session: ProcessSession = {
    pid,
    result,
    get stdout() { return stdout.snapshot(); },
    get stderr() { return stderr.snapshot(); },
    async write(data) {
      if (child.stdin.destroyed || child.stdin.writableEnded) throw new ProcessError('PROCESS_STDIN_CLOSED', 'Process stdin is closed');
      inputWasWritten = true;
      await new Promise<void>((accept, reject) => {
        let finished = false;
        const done = (error?: Error | null) => {
          if (finished) return;
          finished = true;
          child.stdin.removeListener('close', closed);
          child.stdin.removeListener('error', failed);
          if (error) { ioError ??= error; reject(new ProcessError('PROCESS_IO_FAILED', 'Could not write process stdin', { cause: error })); }
          else accept();
        };
        const closed = () => done(new Error('Process stdin closed before the write completed'));
        const failed = (error: Error) => done(error);
        child.stdin.once('close', closed);
        child.stdin.once('error', failed);
        child.stdin.write(data, done);
      });
    },
    async closeInput() {
      if (child.stdin.destroyed || child.stdin.writableEnded) return;
      await new Promise<void>((accept) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          child.stdin.removeListener('finish', done);
          child.stdin.removeListener('close', done);
          child.stdin.removeListener('error', done);
          accept();
        };
        child.stdin.once('finish', done);
        child.stdin.once('close', done);
        child.stdin.once('error', done);
        child.stdin.end(done);
      });
    },
    async stop() { requestStop('stopped'); return result; },
    onOutput(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  if (options.stdin !== undefined) {
    initialInput = (async () => {
      try { await session.write(options.stdin!); await session.closeInput(); }
      catch (error) { ioError ??= asError(error); requestStop('stopped'); }
    })();
  }
  return session;
}
