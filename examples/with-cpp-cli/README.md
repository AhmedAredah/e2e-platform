# A C++ CLI tested through the built e2e runner

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
planted-defect suite to exit 1 with an `ASSERTION_FAILED` report. It does not
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
verification workflow needs neither a network connection nor a model.

The separate command below is expected to fail. It demonstrates that wrong
application output remains a failure; it is not part of the default suite:

```bash
pnpm test:e2e:negative
```

Set `E2E_CPP_BINARY` to an absolute executable path to test another build of the
same calculator contract. CMake writes the default executable to
`build/bin/e2e_cpp_calculator` (`.exe` on Windows), including with multi-config
generators.

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

## Extension structure

`include/calculator/` holds the contracts; `src/` separates parsing, operations,
serialization and application orchestration. `SumOperation` implements the abstract
`BinaryOperation`, and `JsonResultWriter` implements the abstract `ResultWriter`.
Another operation or output schema can supply another subclass; the application
receives these collaborators without inheriting process or test-runner code.
The bundled writer deliberately accepts only the sum schema; another operation
needs a suitable output writer/schema and independent expected values.

Last checked for the MIT fork on 2026-10-24 on Linux x64 with GCC 13.3,
CMake 3.28.3, Node 24.22.1 and the built `@e2e-platform/core` 0.1.0 packages.
Three native CTests and three real runner tests passed. The separate planted
wrong-output test exited 1 with `ASSERTION_FAILED`, with complete cleanup.
Windows and macOS require separate execution.
