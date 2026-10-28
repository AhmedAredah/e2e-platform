# Install this candidate in another project

The C++ review changes use authoring protocol 2: update the host adapter
and rebuild SDK test binaries together. See [the resolution and release gates](docs/development/CPP_REVIEW_RESOLUTION.md).

Use Node.js 22.22.3 or newer in the 22.x line, or Node.js 24.8.0 or newer.
A prepared full-repository bundle can include `release-packages/` with nine built
npm tarballs, a checksum manifest and an installer. A Git clone or GitHub source ZIP
contains source only: run `pnpm install --frozen-lockfile` and `pnpm pack:native`
first. These are candidate builds; they have not been published to the fork namespace.

Install the repository's pinned package manager before those commands:

```sh
npm install --global pnpm@12.3.4
```

Use a writable npm global prefix or your Node version manager's normal setup;
building or running this project does not require elevated privileges.

Create a `package.json` in your test project with `npm init -y`, then run from
the extracted repository:

```sh
node release-packages/install.mjs /absolute/path/to/your-project
```

Quote paths containing spaces. The installer checks every tarball before running
`npm install --save-dev`. It installs `@e2e-platform/core` and the process, checks, native,
terminal, protocol and C++ test-adapter modules. npm resolves their external dependencies online
or from your cache. Keep the kit at the same path for lockfile reinstalls, or
copy it into your project before installation. Registry publication is not required.

To rebuild the kit from source, install the pinned pnpm prerequisites, run
`pnpm install --frozen-lockfile`, then `pnpm pack:native`. The kit is version 0.2.0-rc.8. Coordinated versions and changelogs use Changesets prerelease mode.
Registry names are not reserved or published by creating this kit.

## First command test

Create `e2e.config.ts` in your project:

```ts
import type { E2EConfig } from '@e2e-platform/core';
export default {
  modelPolicy: 'forbid',
  targets: [{ name: 'cli', platform: 'test' }],
} satisfies E2EConfig;
```

Create `tests/command.e2e.ts`. Change the executable and arguments to your app:

```ts
import { test, expect } from '@e2e-platform/process/test';

test('prints the expected version', async ({ processes }) => {
  const result = await processes.run({
    executable: '/absolute/path/to/your-built-application',
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toContain('1.0.0');
});
```

Run `npx --no-install e2e-platform run --no-model`. For the bundled C++ calculator, use the reference
tests under `examples/with-cpp-cli/`. The test must compare output with independently
chosen expectations; a successful exit is only one part of the assertion.

On Windows, npm versions using `cmd-shim` 8.0.0 generate a `.cmd` launcher with an
unquoted directory assignment. An ampersand (`&`) in the project path can break
`npx` or `npm exec`, even when installation succeeds. Use a project path without
ampersands for those launchers, or invoke the installed JavaScript entry directly
from your project; this bypasses the npm batch launcher:

```sh
node "./node_modules/@e2e-platform/core/dist/cli/bin.js" run --no-model
```

The installation smoke test verifies installation, generated tests, positive and
negative process tests, and typechecking in a path containing spaces and
ampersands. It then verifies the real npm executable and an installed TypeScript
test from a conventional path. The launcher limitation is in
[npm's generated command shim](https://github.com/nodejs/node/blob/v24.22.1/deps/npm/node_modules/cmd-shim/lib/index.js).

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
  add_subdirectory("/path/to/e2e-platform/native/qt" "e2e-qt")
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
Use `qt()` from `@e2e-platform/native` as the target engine and point `app.appPath`
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

On macOS, finish the peer installation with:

```sh
npx --no-install e2e-platform-terminal-setup
```

This explicit setup repairs the non-executable `spawn-helper` shipped by
`node-pty` 1.1.0, replacing the installed file without changing shared package-store
copies. Repeat setup after reinstalling the peer. Normal terminal startup checks
the helper without modifying it and reports `DEPENDENCY_MISSING` when setup is
required. If the peer directory is read-only, reinstall it in a writable project,
then run setup.

HTTP services can use `createHttpClient` from `@e2e-platform/protocol`. Launch the
service with a process fixture, check readiness, then assert status, schema and
business results. gRPC and WebSocket clients are not included.

## Browser and mobile applications

The nine-package kit excludes `@e2e-platform/playwright` and
`@e2e-platform/agent-device`. Their MIT-baseline source remains in the checkout.
After `pnpm install --frozen-lockfile`, run these commands from the repository
root to build the optional modules and pack the ones you need. Choose an existing
output directory outside your test project's `node_modules`:

```sh
pnpm build
pnpm --filter @e2e-platform/playwright pack --pack-destination /absolute/path/to/tarballs
pnpm --filter @e2e-platform/agent-device pack --pack-destination /absolute/path/to/tarballs
```

Install the core kit into your test project first. Then, from that project's
directory, use the actual filenames emitted by `pack` (shown here for this
candidate). Either engine can be installed independently:

```sh
# Browser engine:
npm install --save-dev /absolute/path/to/tarballs/e2e-platform-playwright-0.2.0-rc.8.tgz playwright@1.63.0
npx --no-install playwright install chromium

# Mobile engine:
npm install --save-dev /absolute/path/to/tarballs/e2e-platform-agent-device-0.2.0-rc.8.tgz
npx --no-install agent-device doctor
```

Browser downloads need network access or a matching prepared browser cache.
Linux browser hosts also need Playwright's system libraries; the Playwright
installation guide covers its optional `install --with-deps` setup. Mobile tests
require Xcode with a booted iOS simulator on macOS, or an Android SDK and booted
emulator. The mobile npm package includes its `agent-device` runtime dependency;
it does not install an operating-system SDK or emulator.

See the [browser starter](packages/playwright/README.md) and
[mobile starter](packages/agent-device/README.md) for configuration and tests.
Run `npx --no-install e2e-platform run --no-model` for deterministic tests. If you
use `e2e-platform init`, install the desired local engine tarball first so the
initializer preserves its file dependency. Do not accept installation of missing
unpublished `@e2e-platform/*` registry packages. Keep local tarballs at their
recorded paths for later lockfile reinstalls.

## Extend without changing the runner

Subclass `ApplicationLaunchProfile`, `ProcessRunner`, `NativeDriver`, `NativeTransport`, `TerminalTransport`,
`HttpTransport`, or `OutputValidator` for the behavior that differs. Keep each
implementation in its own module. The engine factories inject those implementations.
New backends must honor deadlines, cancellation, cleanup, declared capabilities
and complete observation semantics. `native/README.md` describes the GUI helper
extension path. Qt exposes a versioned public `ControlAdapter` interface registered
before `Bridge.start()`; its internal object adapters remain private.

See [LANGUAGES.md](LANGUAGES.md) and `examples/with-languages/` for real Python,
C# and Rust CLI/HTTP applications. `PythonLaunchProfile`, `DotnetLaunchProfile`
and `ExecutableLaunchProfile` keep executable arguments separate from logical
application identity. The [C++17 SDK](native/cpp-sdk/README.md) now supports C++ test
bodies through `@e2e-platform/cpp` and a small TypeScript discovery file.
[PYTHON.md](PYTHON.md) covers the separately installed Python SDK wheel, pytest
fixtures and matching npm adapter. C# and Rust test-authoring SDKs and additional
toolkit bindings are not included.

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
framework's GUI support. `SUPPORT_MATRIX.md` records the supported interfaces and limits.
