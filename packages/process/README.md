# @e2e-platform/process

Run native applications and C++ command-line programs from e2e tests. Commands launch directly with an argument array, never through a shell. The default local process API requires no compiler or extra runtime beyond Node.js.

```ts
import { runProcess } from '@e2e-platform/process';

const result = await runProcess({
  executable: '/absolute/path/to/solver',
  args: ['--input', 'scenario.json'],
  cwd: '/absolute/path/to/workspace',
  env: { OMP_NUM_THREADS: '1' },
  timeoutMs: 30_000,
});
console.log(result.stdout.bytes.toString('utf8'));
```

`runProcess` sends EOF on stdin, waits for both streams and log files to drain, and expects exit code zero. Supply `expectedExitCodes: [2]` to verify a documented error exit. Provide `stdin` as a string or `Uint8Array` for initial input. `startProcess` instead returns a live session with `pid`, `result`, `write`, `closeInput`, `stop`, bounded `stdout`/`stderr` snapshots, and `onOutput` subscriptions. Its stdin remains open unless initial input is supplied or the caller closes it. Always await completion or stop a live session in teardown.

## Captures and logs

Both pipes drain concurrently. Each capture retains a binary-safe prefix of at most `maxOutputBytes` (default 1 MiB per stream), plus `totalBytes` and `truncated`. Zero retains counters only. Small writes are packed into fixed-size blocks to bound allocation overhead. Decode explicitly; text split across chunks must be decoded with a streaming decoder when using `onOutput`.

Optional `stdoutPath` and `stderrPath` retain full binary streams on disk with backpressure. Relative paths resolve against `cwd`. Their parent directories must exist; files are created exclusively and existing logs are never overwritten. Disk usage is the full emitted output, independent of the memory limit. A log failure fails the operation. No redaction or application sandbox is provided: write sensitive output only to locations appropriate for that data.

An output subscriber receives `{ stream: 'stdout' | 'stderr', bytes: Buffer }` for future chunks. Inspect the session's current capture as well: output can arrive before subscription. Treat event buffers as immutable. Subscriber exceptions stop the process and are reported as I/O failures.

## e2e fixture

```ts
import { test, expect } from '@e2e-platform/process/test';

test('prints its version', async ({ processes }) => {
  const result = await processes.run({
    executable: '/absolute/path/to/my-app',
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toContain('1.0');
});
```

The `processes` fixture supplies `directory`, `run`, `start` and `startService`. Its directory is fresh for every attempt and is the default working directory. Teardown cancels and waits for pending operations, stops owned sessions, and removes the directory after successful cleanup, including when the test itself failed. Copy deliverable evidence outside this temporary directory before teardown.

Those operations are recorded as report steps with constant labels. Finite commands
also attach a small JSON diagnostic containing status, exit code, signal, elapsed
time, stream byte counts, capture truncation and whether I/O failed. It excludes
executable paths, arguments, environment variables, stdin and output contents.
Full logs remain explicit caller-owned files. Calls read the current fixture phase's
cancellation signal, including a fresh teardown signal after a body timeout.

Await or deliberately handle every process-operation promise. A dropped rejected
operation now fails fixture teardown even when its process was successfully cleaned
up. An intentionally awaited/caught exit failure is allowed, and ordinary Promise
chaining, `catch`, `finally` and `Promise.all` retain their behavior. This guard does
not infer that an arbitrary detached promise chain was handled correctly. Standalone
`runProcess` keeps ordinary Promise semantics; the guard belongs to the workspace
and recorded fixture. A failed command with successful cleanup does not retain its
temporary directory solely because its promise was dropped.

If process cleanup fails, disposal rejects with an `AggregateError` and retains the directory so a child whose termination is uncertain does not lose its files. The retained directory can contain inputs and application output. Record `processes.directory` when diagnosing a failure, confirm that the owned processes have stopped, then inspect or remove the directory according to your data-retention policy.

Importing the main process API does not import e2e; the `/test` entry supplies the `test.extend` integration. `ProcessWorkspace.create()` provides the same lifetime management outside the e2e runner; call `dispose()` in `finally`. Its `directory` property identifies the retained directory if cleanup fails.

## Application services

`ApplicationService` and `ServiceReadiness` separate process ownership from a
service's actual readiness condition. `PredicateReadiness` adapts a callback; a
subclass can share an HTTP, socket, output-marker or application-specific probe.

```ts
import { PredicateReadiness } from '@e2e-platform/process';
import { test, expect } from '@e2e-platform/process/test';

test('service returns the expected result', async ({ processes }) => {
  const url = 'http://127.0.0.1:8080'; // Allocate a distinct port per worker.
  const service = await processes.startService({
    process: { executable: '/absolute/path/to/server', args: ['--port', '8080'] },
    startupTimeoutMs: 5000,
    pollIntervalMs: 50,
    readiness: new PredicateReadiness(async ({ signal }) => {
      try { return (await fetch(`${url}/health`, { signal })).status === 200; }
      catch { signal.throwIfAborted(); return false; }
    }),
  });
  const response = await fetch(`${url}/result`);
  expect(await response.json()).toEqual({ result: 42 });
  await service.stop();
});
```

The readiness deadline starts after process acquisition and bounds the entire probe
loop, including a stalled probe. Probes receive an abort signal and remaining budget;
they must honor cancellation for any connections/resources they create. A deadline,
abort, thrown probe or early process exit stops and drains the owned child. Readiness
does not accept an exit code of zero in place of a successful probe. Once ready, a
service must remain alive until `stop()` or workspace cancellation: an unexpected
exit fails workspace disposal. Use ordinary `start()` for a process intended to
finish on its own. Standalone `ApplicationService.start(options, runner?)` callers
must call `stop()` in `finally` and `assertHealthy()` to check unexpected exits.

Fresh workspace directories reset files written there between attempts. Configure
the application to use that directory for its state, and explicitly isolate its
profile, database, ports and external services. The service fixture does not clear
global user profiles or infer business correctness from a successful health check.

Use `createProcessTest({ runner })` from `@e2e-platform/process/test` to select a
supervisor for the same recorded fixture. `ProcessWorkspace.create(runner)` supplies
that ownership model outside the test runner.

## Extend the supervisor

The public `ProcessRunner` abstract class owns finite-command exit assertions. `LocalProcessRunner` supplies the local OS session implementation. Alternative supervisors implement `start()` and return the same `ProcessSession` contract; they inherit the common `run()` behavior. Convenience functions delegate to one local runner.

```ts
import {
  LocalProcessRunner, ProcessRunner, ProcessWorkspace,
  type ProcessOptions, type ProcessSession,
} from '@e2e-platform/process';

class AuditedRunner extends ProcessRunner {
  private readonly local = new LocalProcessRunner();

  override start(options: ProcessOptions): Promise<ProcessSession> {
    console.log('Starting executable:', options.executable);
    return this.local.start(options);
  }
}

const workspace = await ProcessWorkspace.create(new AuditedRunner());
try {
  await workspace.run({ executable: '/absolute/path/to/my-app', timeoutMs: 5000 });
} finally {
  await workspace.dispose();
}
```

A custom supervisor must honor cancellation, deadlines, binary captures, completed output, and owned cleanup. This seam does not claim a remote/container backend is included.

## Results and failure categories

Completed sessions resolve `result` with `status`, `exitCode`, `signal`, `durationMs`, executable/argument/working-directory provenance, both captures, and any `ioError`. `status` distinguishes `exited`, `signaled`, `timed-out`, `aborted`, and `stopped`. `runProcess` turns a violated contract into `ProcessError`, carrying `.code`, `.cause` when available, and `.result` when the process completed.

| Code | Meaning |
| --- | --- |
| `PROCESS_SPAWN_FAILED` | The executable could not start, including an invalid working directory. |
| `PROCESS_EXIT_FAILED` | The exit code is outside the expected set, or a finite command was stopped. |
| `PROCESS_SIGNALED` | The process terminated from a signal. |
| `PROCESS_TIMED_OUT` | The wall-clock deadline expired. |
| `PROCESS_ABORTED` | Caller or fixture cancellation was requested. |
| `PROCESS_IO_FAILED` | Input, output, subscriber, or disk logging failed. |
| `PROCESS_STDIN_CLOSED` | A caller attempted to write after stdin closed. |
| `PROCESS_CLEANUP_FAILED` | Tree cleanup failed or inherited output pipes did not close. |

Invalid arguments fail with `TypeError` before launch. `timeoutMs` includes the child lifetime; omitted means no execution deadline. `killGraceMs` defaults to 500 ms on POSIX. `drainTimeoutMs` bounds inherited pipes after root exit (default 5000 ms); expiration closes the pipes and fails cleanup. Environment values inherit from the controller unless `inheritEnv: false`; `env` overrides values and `undefined` removes them. Windows variable names are matched case-insensitively.

With `inheritEnv: false`, supply the runtime executable path and any required `PATH`,
temporary-directory or profile variables deliberately. On Windows, `SystemRoot`
is retained for OS/Winsock initialization unless you explicitly override or remove
it. Other omitted Windows bootstrap variables are supplied as empty strings to
prevent libuv from silently restoring their parent values. Explicitly removing
one of those variables also leaves an empty value. Ambient `NODE_V8_COVERAGE` is
not propagated into an isolated environment or restored after explicit removal.
Child startup libraries can initialize their own variables; for example, macOS
CoreFoundation may create `__CF_USER_TEXT_ENCODING` from the user's encoding settings.
This environment policy is not a process security sandbox.

## Platform boundaries

On POSIX the local supervisor creates a dedicated process group and uses SIGTERM followed by SIGKILL. It also cleans remaining group members when the root exits naturally. On Windows the default `LocalProcessRunner` uses the system `taskkill /PID /T /F` command while the root is alive. This is forceful on Windows; the POSIX grace period does not apply there. Windows descendants surviving a naturally exited root cannot reliably be recovered with taskkill. Select the optional Job Object supervisor below for owned Windows process containment. GUI applications that change process groups, spawn through external services, or require elevated privileges still need explicit application/platform qualification. The post-exit drain deadline avoids waiting forever for inherited pipes; it cannot contain escaped processes.

### Explicit Windows Job Object supervisor

`WindowsJobProcessRunner` uses the separately installed
[`native/windows-process`](../../native/windows-process/README.md) supervisor. Build
or publish that helper on Windows, then select its absolute executable path:

```ts
import { WindowsJobProcessRunner } from '@e2e-platform/process';
import { createProcessTest } from '@e2e-platform/process/test';

export const test = createProcessTest({
  runner: new WindowsJobProcessRunner({
    executable: 'C:\\e2e-tools\\E2E.Platform.WindowsProcess.exe',
    launchTimeoutMs: 30_000,
    shutdownTimeoutMs: 5000,
  }),
});
```

An explicit `dotnet` host plus `args: [absoluteSupervisorDll]` is also supported.
The native helper is source-distributed separately from this npm package; a missing
helper fails launch without falling back to taskkill. Target executable paths must
also be absolute. The helper creates each child suspended, assigns it to a
kill-on-close Job Object, then resumes it. Normal root exit, stop, timeout,
cancellation, controller EOF and controller death trigger owned-job cleanup.
Successful completion requires the helper's job-empty and stream-drain confirmation.
A helper crash or forced shutdown without that confirmation is a cleanup failure.

Transport uses bounded JSONL frames, binary output chunks, one acknowledged input
write at a time, and no shell. Await `write()` before another input write. The native
drain budget is limited to 30 seconds, default 5 seconds. `shutdownTimeoutMs` bounds
the helper's stop acknowledgement before the controller force-closes its owner;
`killGraceMs` does not provide graceful Windows shutdown. Windows environment names
are matched case-insensitively; the helper passes the selected environment directly
to `CreateProcess`, so removed variables are absent rather than libuv bootstrap
placeholders. A successful helper launch does not grant elevation or control over
processes created through external services.

Portable client tests verify framing, input backpressure, cancellation, reporting
failures and cleanup acknowledgement. These tests do not qualify native Job Object
behavior. The helper's Windows lifecycle tests and CI job must pass on the intended
Windows architecture before claiming native support for that release artifact.

The actual TypeScript client also has an opt-in native integration suite. On Windows,
set `E2E_WINDOWS_JOB_HELPER` and `E2E_WINDOWS_JOB_FIXTURE` to the absolute published
helper and test-fixture executable paths documented in the native helper README,
then run `pnpm --filter @e2e-platform/process exec vitest run tests/integration/windows-job.native.test.ts`.

On macOS, the kernel can return `EPERM` while an owned group contains only zombies awaiting reaping. The supervisor yields and retries that error at most ten times, with 10 ms between attempts, for each signal. Cleanup still requires a successful signal or `ESRCH` confirming that the group is gone; persistent permission errors remain failures. The configured grace interval starts after SIGTERM succeeds. This handles the [XNU process-group signaling behavior](https://github.com/apple-oss-distributions/xnu/blob/xnu-11215.81.4/bsd/kern/kern_sig.c) without bypassing permission checks.

`terminateProcessTree(pid, { graceMs })` is available for other adapters. On POSIX the PID must identify a process-group leader owned by the caller, as created by `startProcess`; never pass an unrelated process PID. Windows requires a live owned root. This package does not provide PTY/ConPTY terminal emulation: use a terminal adapter for full-screen or TTY-dependent applications. Batch `.exe`/ELF/Mach-O programs are supported independently of CLI parsing libraries.

Linux behavior is covered by binary-output, input/EOF, cancellation, timeout, escalation, process-group, pipe-drain, subclass, and workspace tests. The portable suite also runs on Windows/macOS; those platforms require their CI jobs or a local run before claiming verification.

Primary references: [Node subprocess behavior](https://nodejs.org/api/child_process.html), [Microsoft taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill), [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Application launch profiles

`ApplicationLaunchProfile` is the extension boundary for runtime-specific launch
commands. `PythonLaunchProfile` takes an explicit `interpreter` and `script`;
`DotnetLaunchProfile` takes `dotnet` and a built `assembly`;
`ExecutableLaunchProfile` takes a built executable, including Rust binaries.
Each requires a logical `identity`, accepts a separate optional
`buildFingerprint`, and resolves an immutable `{ identity, buildFingerprint?,
process }` plan. Pass `plan.process` to `runProcess` or a process fixture, adding
its timeout and cancellation policy.

Profiles copy `args` and `env`, anchor entry points to `cwd`, default to
`inheritEnv: false`, and pass argument arrays directly without a shell. The
metadata does not implicitly change runner cache/session keys, and the profile
does not build the application or verify caller-provided fingerprints. See
[`LANGUAGES.md`](../../LANGUAGES.md) and the real three-language CLI/HTTP example
for complete usage and qualification boundaries.
