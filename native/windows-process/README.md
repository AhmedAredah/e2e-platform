# Windows owned-process supervisor

This optional MIT-licensed helper supplies Windows Job Object ownership for the
`WindowsJobProcessRunner` in `@e2e-platform/process`. It runs CLI applications and
service processes regardless of their implementation language. Install it
separately and select it explicitly; the ordinary `LocalProcessRunner` does not
gain these guarantees merely because this source directory is present.

The helper uses a Windows 10 / Server 2016 API baseline on an edition and release
[supported by .NET 10](https://learn.microsoft.com/en-us/dotnet/core/install/windows).
Install the .NET 10 runtime or use a self-contained publish for the chosen Windows
architecture; a self-contained publish does not extend operating-system support.
It is not an accessibility driver,
terminal emulator, application sandbox, or GUI input engine.

## Build and install

From the repository root with the .NET 10 SDK:

```powershell
dotnet publish native/windows-process/src/Driver/E2E.Platform.WindowsProcess.csproj -c Release -r win-x64 --self-contained true -o build/windows-process
```

Use `win-arm64` for ARM64. Keep the entire publish directory together, including
the MIT license. Point `WindowsJobProcessRunner` at the absolute path to
`E2E.Platform.WindowsProcess.exe`. A framework-dependent publish is also supported
when .NET 10 is already installed. The helper accepts protocol input on stdin; it
does not accept a shell command line to execute.

## Ownership and lifecycle

Each application starts suspended, inside a new private Job Object using
`PROC_THREAD_ATTRIBUTE_JOB_LIST`. The helper verifies membership before resuming
the first thread. The Job Object sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and
does not permit child breakaway. Its noninherited handle remains private to the
helper. `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` restricts handle inheritance to the
three application standard streams. Launch failures do not fall back to an
unowned process or a shell. Existing parent-job restrictions can make launch
fail, and that failure is reported explicitly.

Root exit, explicit stop, controller stdin EOF, and the monitored controller
process exiting all terminate the job's remaining descendants. Abrupt helper
exit closes the last job handle, which triggers Windows cleanup. A successful
terminal event requires the job's active process count to reach zero and both
output streams to drain. Cleanup has a five-second verification deadline;
unverified cleanup reports `CLEANUP_FAILED`. Stop is forceful: a POSIX-style
graceful signal interval is unavailable through this helper.

This is process lifetime ownership, not protection from a malicious application
with the user's permissions. It cannot own processes launched indirectly through
an existing external service, another user, or a privileged broker. A controller
supplies its own PID; the helper opens and retains that process handle before
launch so subsequent PID reuse cannot change the monitored lifetime.

## Protocol version 1

Input and output are UTF-8 JSON lines. Input frames are limited to 128 KiB, have
closed fields, reject duplicate keys, and use strictly increasing positive
JavaScript-safe integer IDs. The first request must have ID 1:

```json
{"kind":"launch","version":1,"id":1,"executable":"C:\\apps\\example.exe","args":[],"cwd":"C:\\apps","env":{"PATH":"C:\\Windows\\System32"},"parentPid":1234,"drainTimeoutMs":5000}
```

`executable` and `cwd` must be existing absolute paths. Arguments are literal,
quoted with Windows C runtime rules; no shell expansion or PATH lookup occurs.
`env` is the complete target environment; it is not merged with the helper's
environment. Windows environment names are case insensitive, and ambiguous
duplicates are rejected. `drainTimeoutMs` is optional, defaults to 5000, and
accepts integers from 0 through 30000. It bounds post-exit output draining, not
application runtime; the runner controls its runtime timeout by sending stop.
Zero requires the application streams to have finished already when root exit is
observed; only the final protocol messages get a one-second delivery allowance.
The helper requires the launch frame within 30 seconds.

The first output is `{"kind":"started","id":1,"pid":1235}`. Later requests:

| Request | Completion |
| --- | --- |
| `{"kind":"stdin","id":2,"data":"AAE="}` | Ack after the decoded bytes are written. At most 64 KiB per request. |
| `{"kind":"eof","id":3}` | Ack after closing application stdin. |
| `{"kind":"stop","id":4}` | Ack after requesting forceful job termination. Final exit verifies cleanup. |

Acknowledgements have the form `{"kind":"ack","id":2}`. Await each input ack
before sending another stdin or eof request. Stop remains accepted while a write
is blocked. A terminal result can arrive instead of an outstanding input ack
when the target exits or is stopped.

Output events contain `kind: "output"`, `stream: "stdout" | "stderr"`, and
canonical base64 `data`, with at most 16 KiB decoded per event. The output queue
holds at most eight events; backpressure reaches the application without growing
an unbounded in-memory log. Neither diagnostics nor errors copy request values.
Captured application output is deliberately forwarded and can contain secrets;
the caller controls redaction, storage, and retention.

`{"kind":"rootExit","exitCode":23}` records the root's unsigned Windows exit
code. After descendant cleanup and output drain, the final event is:

```json
{"kind":"exit","exitCode":23,"stopped":false,"cleanup":true}
```

Fatal errors have `kind: "error"`, a fixed `message`, and one of `INVALID_REQUEST`,
`LAUNCH_FAILED`, `STDIN_CLOSED`, `IO_FAILED`, or `CLEANUP_FAILED`. They cause a
nonzero helper exit. A fatal error, unexpected EOF, missing terminal event, or
nonzero helper exit is never a successful test result. The runner must also bound
its own protocol buffers and output retention.

## Verification

Portable protocol checks run on any .NET 10 SDK host:

```sh
dotnet run --project native/windows-process/tests/ProtocolTests/E2E.Platform.WindowsProcess.Protocol.Tests.csproj -c Release
```

Real Windows lifecycle tests need Windows and Python 3; no interactive desktop is
required:

```powershell
dotnet publish native/windows-process/src/Driver/E2E.Platform.WindowsProcess.csproj -c Release -r win-x64 --self-contained false -o build/windows-process
dotnet publish native/windows-process/tests/ProcessFixture/E2E.Platform.WindowsProcess.Fixture.csproj -c Release -r win-x64 --self-contained false -o build/windows-process-fixture
python native/windows-process/tests/live_smoke.py --helper build/windows-process/E2E.Platform.WindowsProcess.exe --fixture build/windows-process-fixture/E2E.Platform.WindowsProcess.Fixture.exe
```

The live suite verifies literal arguments and environment, binary input/output,
exit codes, backpressure (including a controller that stops reading), natural root exit with a live descendant, forced stop
during blocked input, controller EOF, monitored parent exit, abrupt helper death,
and content-free malformed-request failure. Compilation and portable tests alone
do not establish Windows runtime qualification.

The design follows Microsoft's documentation for [process creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
and [atomic assignment at creation](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812).
