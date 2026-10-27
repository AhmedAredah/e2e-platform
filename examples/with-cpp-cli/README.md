# C++ CLI and HTTP applications tested through the e2e runner

This C++17 calculator emits JSON on stdout and can export the same result to a
file. Tests launch the real compiled executable, send stdin, preserve expected
nonzero exits, and independently check exported numbers. No model or API key
is used. `--wrong-output` deliberately adds one to the sum; the negative suite
must fail even though the executable exits successfully.
The example source is [MIT licensed](LICENSE).

## From this source checkout

Install the repository's JavaScript dependencies and build its packages first
(see [SUPPORT_MATRIX.md](../../SUPPORT_MATRIX.md)). Install CMake 3.21 or newer and a
C++17 compiler: GCC/Clang, Xcode command-line tools, or Visual Studio 2022 C++
build tools. CTest comes with CMake.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build:native
node scripts/native/verify.mjs
```

The script builds this executable, runs CTest, links the built local packages
into this example, runs the three positive e2e tests, then requires the separate
planted-defect suite to exit 1 with an `ASSERTION_FAILED` report. It also builds a bounded C++ HTTP reference server and checks its arithmetic, HTTP status codes and malformed-input handling, then rejects a planted incorrect response despite status 200. It does not
download packages or toolchains. It stops if prerequisite builds are missing.
Use a clean example dependency directory; it will not overwrite an existing
non-link package installation.

## Run individual steps

From this directory, after installing and building the workspace from its root:

```bash
pnpm build:native
pnpm test:ctest
pnpm test:e2e
```

This example uses local `workspace:*` dependencies because the C++ extension
packages are source additions, not published releases. Install them with pnpm
from the repository root. The initial dependency install
needs registry access or a populated package-manager cache. After setup, its
verification workflow needs neither an external network connection nor a model.

The separate command below is expected to fail. It demonstrates that wrong
application output remains a failure; it is not part of the default suite:

```bash
pnpm test:e2e:negative
```

Set `E2E_CPP_BINARY` to an absolute executable path to test another build of the
same calculator contract. CMake writes the default executable to
`build/bin/e2e_cpp_calculator` (`.exe` on Windows), including with multi-config
generators.

## HTTP reference fixture

`e2e_cpp_http` listens only on an ephemeral `127.0.0.1` port. Its
`LoopbackHttpServer` owns sockets and request deadlines; the injected
`CalculatorHttpHandler` implements `HttpHandler` and uses `BinaryOperation`.
It is a bounded local fixture, not a production HTTP server and not certification
of Drogon, Crow, Boost.Beast or another framework. It supports only simple GET
requests to `/health` and `/sum?a=<number>&b=<number>`, rejects unsupported methods
and invalid/nonfinite/duplicate operands, caps headers at 8 KiB and closes each
connection. The test owns readiness, HTTP requests and process cleanup.

```sh
pnpm test:http
# Intentionally exits 1 with ASSERTION_FAILED:
pnpm test:http:negative
```

`E2E_CPP_HTTP_BINARY` can select another build of this reference contract.
The verifier discovers the configured executable through the CMake File API,
so it does not guess single-config versus multi-config output paths.

## Evidence

The verification script retains positive and negative runner reports under
`.e2e/positive/` and `.e2e/planted-negative/`, and stdout, stderr and exported
JSON under `.e2e/cpp-evidence/`. CTest writes `build/ctest-results.xml`.
The process fixture's working directory is temporary; evidence paths are
explicit absolute paths outside it. These artifacts can contain application
output and are not a general secrets-redaction boundary.

CTest's negative parser tests check a nonzero exit. The e2e tests check the exact
expected exit code and diagnostic, so an arbitrary crash is not accepted as
successful bad-input handling. Numerical tolerances are explicit, and expected
values are not regenerated from the program being tested.

Malformed, partially parsed, out-of-range and non-finite operands all produce
exit code 2, empty stdout and `error: expected a finite number: <input>` on stderr.
The diagnostic is the same across C++ standard libraries, regardless of which
numeric-extraction stage detects the invalid input.

## Extension structure

`include/calculator/` holds the contracts; `src/` separates parsing, operations,
serialization and application orchestration. `SumOperation` implements the abstract
`BinaryOperation`, and `JsonResultWriter` implements the abstract `ResultWriter`.
Another operation or output schema can supply another subclass; the application
receives these collaborators without inheriting process or test-runner code.
The bundled writer deliberately accepts only the sum schema; another operation
needs a suitable output writer/schema and independent expected values.

Qualification belongs to the exact source revision and selected toolchain. The
verifier records CMake/compiler identity, platform and architecture in
`.e2e/cpp/verification.json` at the repository root. HTTP reports are retained in
`.e2e/http-positive/` and `.e2e/http-negative/`. CI executes these same checks on
Linux, Windows and macOS; consult the completed run before declaring a profile
qualified. An expected assertion failure counts only with complete cleanup and
no setup/provider/secondary errors.
