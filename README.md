# e2e-cpp

An extensible MIT-based fork of [TesterArmy e2e](https://github.com/tester-army/e2e)
for testing compiled commands, terminal applications, HTTP services and cooperative
Qt desktop applications with TypeScript tests. Independent output checks catch
wrong results even when an application exits successfully or displays success.

The fork starts from upstream commit
`e9c2914c6d8f8d664d820b13a1fa454e9247e94b`, whose committed license is MIT.
It retains that revision's browser/mobile engines and tests. C++ extensions and
selected compatibility/security changes were applied to this MIT source; the
later Apache-licensed upstream tree was not relabeled. See the
[licensing record](docs/development/LICENSING.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

## Install and run

Use Node.js **22.22.3+ in the 22.x line, or 24.8.0+**. These fork package names
are local release identities; registry publication and namespace ownership are
not established. Use the checksummed local installation kit in the download:

```sh
# Your project must already have a package.json.
node release-packages/install.mjs /absolute/path/to/your-project
```

The kit installs `@e2e-cpp/core` and the five C++ extension packages. External
JavaScript dependencies require network access or a populated npm cache. CMake,
compilers, Qt and optional terminal native dependencies are separate prerequisites.
Follow [INSTALL_CPP.md](INSTALL_CPP.md) for a complete first test, Qt integration
and consumer installation instructions.

```ts
import { test, expect } from '@e2e-cpp/process/test';

test('prints the correct version', async ({ processes }) => {
  const result = await processes.run({
    executable: '/absolute/path/to/my-application',
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toContain('1.0.0');
});
```

Configure `modelPolicy: 'forbid'` and run `npx --no-install e2e-cpp run --no-model`
for deterministic tests. Model-backed operations require an explicitly configured
provider. The fork disables the inherited upstream telemetry transport.

## Modules and extension design

| Module | Responsibility |
| --- | --- |
| `@e2e-cpp/core` | Test SDK, engine contract, runner, reports and `e2e-cpp` CLI |
| `@e2e-cpp/process` | Bounded subprocess execution, streams, cancellation and cleanup |
| `@e2e-cpp/checks` | Independent numeric, JSON and keyed CSV comparisons |
| `@e2e-cpp/native` | Native engine, driver and transport abstractions; cooperative Qt driver |
| `native/qt` | C++ Qt Widgets/Quick bridge, internal control adapters and installed CMake package |
| `@e2e-cpp/terminal` | Terminal engine, VT state and injectable transport; optional `node-pty` |
| `@e2e-cpp/protocol` | Bounded HTTP transport, JSON/status/schema validation |
| `@e2e-cpp/playwright`, `agent-device`, `github`, `oauth` | Retained MIT-baseline browser/mobile, reporter and provider integrations |

Abstract classes and injected collaborators separate platform behavior, process
supervision, transport, observation and validation. Extend the relevant contract
instead of introducing toolkit-specific branches into the runner. The
[support matrix](CPP_SUPPORT.md) identifies implemented capabilities and the work
required for GTK, wxWidgets, JUCE, FLTK, ImGui and other frameworks. They do not
currently have dedicated native drivers.

## Source development

```sh
pnpm install --frozen-lockfile
pnpm check:local
pnpm test
node scripts/cpp/verify.mjs
# With a matching Qt 6 development kit and runtime modules:
node scripts/cpp/verify.mjs --qt --require-quick
pnpm verify:qt:install
pnpm verify:qt:exports
pnpm pack:cpp
node scripts/cpp/install-kit-smoke.mjs
```

The pinned package manager is pnpm 12.3.4. Full runner/browser integration tests
need the matching Playwright browser installation. Qt checks require CMake 3.21+,
a C++17 compiler and the selected Qt kit. Agent suites need provider credentials
and are manual CI jobs; ordinary C++ checks need no model.

- [Repository layout and offline setup](OFFLINE_README.md)
- [Verification commands and evidence](verification/README.md)
- [Release status and qualification limits](RELEASE_STATUS.md)
- [Contributing](CONTRIBUTING.md)

`packages/` contains reusable modules, `apps/` private regression applications,
`native/` compiled helpers, `examples/` consumer projects, `docs/` reference pages
and `scripts/` maintenance tooling. Generated reports, build trees and dependencies
are excluded from source; the downloadable kit is an intentional generated artifact.
