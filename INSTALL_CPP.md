# Install this candidate in another project

Use Node.js 22.22.3 or newer in the 22.x line, or Node.js 24.8.0 or newer.
The complete repository ZIP includes `release-packages/` with six built npm
tarballs, a checksum manifest and an installer. These are local candidate builds;
they have not been published to the fork namespace.

Create a `package.json` in your test project with `npm init -y`, then run from
the extracted repository:

```sh
node release-packages/install.mjs /absolute/path/to/your-project
```

Quote paths containing spaces. The installer checks every tarball before running
`npm install --save-dev`. It installs `@e2e-cpp/core` and the process, checks, native,
terminal and protocol modules. npm resolves their external dependencies online
or from your cache. Keep the kit at the same path for lockfile reinstalls, or
copy it into your project before installation. Registry publication is not required.

To rebuild the kit from source, install the pinned pnpm prerequisites, run
`pnpm install --frozen-lockfile`, then `pnpm pack:cpp`. The kit is version 0.2.0-rc.0. Coordinated versions and changelogs use Changesets prerelease mode.
Registry names are not reserved or published by creating this kit.

## First command test

Create `e2e.config.ts` in your project:

```ts
import type { E2EConfig } from '@e2e-cpp/core';
export default {
  modelPolicy: 'forbid',
  targets: [{ name: 'cli', platform: 'test' }],
} satisfies E2EConfig;
```

Create `tests/command.e2e.ts`. Change the executable and arguments to your app:

```ts
import { test, expect } from '@e2e-cpp/process/test';

test('prints the expected version', async ({ processes }) => {
  const result = await processes.run({
    executable: '/absolute/path/to/your-built-application',
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toContain('1.0.0');
});
```

Run `npx --no-install e2e-cpp run --no-model`. For the bundled C++ calculator, use the reference
tests under `examples/with-cpp-cli/`. The test must compare output with independently
chosen expectations; a successful exit is only one part of the assertion.

Read C++ JSON using `readJsonFile(path, byteLimit, { decimalPrecision: 'binary64' })`
when the producer uses `max_digits10` for `double`. The default is exact decimal
round-trip validation. Store 64-bit identifiers and higher-precision values as
strings. Configure numerical comparison tolerances explicitly.

For editor and compiler checks, install `typescript` and `@types/node` in the test
project and set `compilerOptions.types` to `["node"]` with `module: "NodeNext"`.
The CLI itself executes TypeScript tests without a separate compile step. The core
package requires the `ai` peer because its public TypeScript declarations refer
to AI SDK types; npm installs it with the kit. Installing that dependency does
not enable model calls. Use `modelPolicy: 'forbid'` or `--no-model` to prohibit them.

## Add the helper to a Qt test build

Install CMake and your Qt 6 development kit with Widgets, Network and Test.
Quick applications also need Quick/QML and the runtime QML modules they import.
Keep the helper disabled in normal application builds:

```cmake
option(ENABLE_E2E "Include cooperative automation in a test build" OFF)
if(ENABLE_E2E)
  add_subdirectory("/path/to/e2e-cpp/native/qt" "e2e-qt")
  target_link_libraries(your_app PRIVATE E2E::QtBridge)
  target_compile_definitions(your_app PRIVATE ENABLE_E2E=1)
endif()
```

In `main.cpp`, after constructing `QApplication` and the main window, keep the
bridge alive through `app.exec()`:

```cpp
#ifdef ENABLE_E2E
#include <e2e/qt/bridge.h>
#endif
// ... construct QApplication app and your window ...
#ifdef ENABLE_E2E
e2e::qt::Bridge bridge;
bridge.start();
#endif
// return app.exec();
```

`start()` opens no listener unless the runner supplies its per-launch token.
Give controls stable `objectName` values and accessible names, and mark generic
secret controls with `e2eSecure`. Password controls are detected separately.
Use `qt()` from `@e2e-cpp/native` as the target engine and point `app.appPath`
at the test-build executable. The complete config and tests are in
`examples/with-qt/e2e/`.

For installed CMake usage, build/install `native/qt`, then use
`find_package(e2eQtBridge CONFIG REQUIRED)` and link `E2E::QtBridge`.
Set `CMAKE_PREFIX_PATH` to the installation prefix. Both static and shared builds
are supported; distribute shared-library and Qt runtime dependencies for your OS.
Run `pnpm verify:qt:install` to exercise both exported consumer configurations.

## Terminal and HTTP applications

Real PTYs need the optional `node-pty` peer. Install it in your test project with
`npm install --save-dev node-pty@1.1.0`. Follow your package manager's native-build
approval mechanism; pnpm 11/12 users may need `pnpm approve-builds`. A custom
`TerminalTransport` can operate without that peer. See `packages/terminal/README.md`
for a full TUI test and platform containment limits.

HTTP services can use `createHttpClient` from `@e2e-cpp/protocol`. Launch the
service with a process fixture, check readiness, then assert status, schema and
business results. gRPC and WebSocket clients are not included.

## Extend without changing the runner

Subclass `ApplicationLaunchProfile`, `ProcessRunner`, `NativeDriver`, `NativeTransport`, `TerminalTransport`,
`HttpTransport`, or `OutputValidator` for the behavior that differs. Keep each
implementation in its own module. The engine factories inject those implementations.
New backends must honor deadlines, cancellation, cleanup, declared capabilities
and complete observation semantics. `native/README.md` describes the GUI helper
extension path. Qt's internal adapters are not an installed binary plugin API.

See [LANGUAGES.md](LANGUAGES.md) and `examples/with-languages/` for real Python,
C# and Rust CLI/HTTP applications. `PythonLaunchProfile`, `DotnetLaunchProfile`
and `ExecutableLaunchProfile` keep executable arguments separate from logical
application identity. Tests continue to use TypeScript/JavaScript; language-native
authoring SDKs and further GUI bindings are not included.

## Qualification and publication

Run `pnpm check:local` for the repository checks that do not call Mintlify.
`pnpm check` runs the same local gate. The optional docs `check:online` command
contacts Mintlify and is outside local/offline qualification.

Use [RELEASE_STATUS.md](RELEASE_STATUS.md) for qualification status and known limits.
The [verification guide](verification/README.md) lists reproducible source checks
and their output locations. Detailed release evidence is delivered separately
from the source archive; generated reports and screenshots are not source files.
Windows/macOS runtime tests, npm namespace ownership, trusted publishers and the
GitHub ruleset must be checked in the maintainer's environment. This archive does
not include OS toolchains, installed dependency caches or a promise of every C++
framework's GUI support. `CPP_SUPPORT.md` records the supported interfaces and limits.
