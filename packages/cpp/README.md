# Tests authored in C++

`@e2e-platform/cpp` registers compiled C++17 test cases with the existing runner.
The separately installed [C++ SDK](../../native/cpp-sdk/README.md) provides
`Session`, `App`, `Locator`, polling assertions, process commands and HTTP requests.
Each case has its own owned child process and uses the runner's retries, workers,
verdicts, cancellation and reports. A short TypeScript discovery file connects the
binary to the runner; test bodies and assertions are C++.

Install the checked local npm kit described in [INSTALL.md](../../INSTALL.md),
install `e2eCpp` with CMake, and build your test binary. This package has not been
published to npm. The [compiled example](../../examples/with-cpp-sdk/README.md)
includes CLI and Qt cases and a deliberately incorrect assertion.

```ts
// tests/application.e2e.ts
import { registerCppTests } from '@e2e-platform/cpp';
await registerCppTests({ executable: '/absolute/path/to/compiled-tests', timeoutMs: 30_000 });
```

Use an engine-less target for CLI/HTTP cases or configure the native engine for
desktop controls. Run `npx --no-install e2e-platform run --no-model`. The executable's
`--e2e-list` mode only lists cases; `--e2e-case NAME` executes one. Discovery is bounded
to five seconds by default. Case deadlines default to thirty seconds and remain
subject to the runner's attempt budget. Use absolute executable paths: process
workspaces are isolated temporary directories.

Pass an explicit `runner` to `registerCppTests` to select another `ProcessRunner`,
including `new WindowsJobProcessRunner({ executable: absoluteHelperPath })` after
installing the optional Windows supervisor. Discovery, C++ test children and their
command requests all use that same supervisor; launch failures never fall back.

The protocol reserves stdin/stdout for UTF-8 newline-delimited JSON. The SDK routes
ordinary `std::cout` diagnostics to stderr during a body. Requests have exactly
`{ protocol: 1, id, method, params }`; responses contain the same protocol and ID
and either `result` or `error: { message }`. IDs increase, only one request may be
in flight, lines are limited to 1 MiB, and a case permits at most 10,000 requests.
Malformed streams, transport failures, premature exit and deadlines fail the case.
Application values and child stderr are excluded from transport error messages.

A failed host operation stays failed even if the C++ body catches its exception.
The SDK additionally rejects duplicate response keys and nesting beyond 64 levels.
The TypeScript host uses the standard JSON parser for requests (including its
last-key-wins duplicate-key behavior), then checks closed envelopes and operation
fields. Both directions enforce their byte and request-count limits.

`process.run` returns UTF-8 output capped at 128 KiB per stream and an explicit
`truncated` flag; HTTP bodies are capped at 128 KiB. Binary comparisons should use
the underlying TypeScript process/checks modules until a binary C++ API is added.
HTTP status alone is not an assertion: compare the expected status and body.

The host invokes a closed set of public runner operations. It never evaluates
protocol values as code or a shell command. Test binaries are trusted project
code with the runner's OS authority; this transport is not a sandbox.

Desktop coverage depends on the configured engine and the application's accessible
controls. This SDK does not add a GUI backend, OS-wide input, custom-canvas recognition,
embedded DOM access, or bindings for other test frameworks. Python, C# and Rust
test-authoring SDKs remain separate work. Extend the C++ `Transport` abstraction for
another host without duplicating the test runner.
