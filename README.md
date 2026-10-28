# e2e-platform

An extensible MIT-based fork of [TesterArmy e2e](https://github.com/tester-army/e2e)
for testing command-line programs, terminal applications, HTTP services,
desktop controls, web and mobile applications with one TypeScript runner.
Tests can use TypeScript/JavaScript, the C++ authoring bridge, or the new Python/pytest SDK.
C# and Rust applications use these shared test APIs.
Applications may be written in Python, C#/.NET, Rust, C++ or another language.
GUI coverage depends on the exposed controls and selected driver. Independent output checks catch
wrong results even when an application exits successfully or displays success.

Python implementation and qualification boundaries are tracked in the
[Python resolution record](docs/development/PYTHON_REVIEW_RESOLUTION.md). All 25 Python
jobs pass at the recorded Windows/Linux/macOS checkpoint, including installed
Python 3.11–3.15 consumers and PySide6/PyQt6 6.12.0 reference controls.

Review hardening is documented in [the C++ resolution record](docs/development/CPP_REVIEW_RESOLUTION.md).
The [follow-up corrections](docs/development/CPP_FOLLOWUP_RESOLUTION.md) address
numeric parsing, password protection, action readiness, scrolling and shared
desktop scheduling, installation-kit integrity and Cocoa activation. All 47 required hosted jobs passed for code checkpoint
[`6494472`](https://github.com/AhmedAredah/e2e-platform/commit/6494472ac1382a968ca1a4b92241682a323b3b81), including installed
TypeScript, C++ and Python desktop consumers on Linux, Windows and macOS.
An intermittent C++ Qt/Cocoa shutdown crash from an earlier run remains an
explicit stability issue; the successful checkpoint does not establish its cause
or resolution. See [release status](RELEASE_STATUS.md).
This remains a prerelease with bounded support; additional controls and toolkits
require their own real-application qualification.

The current prerelease is **0.2.0-rc.8**. Its source branch is
[`main`](https://github.com/AhmedAredah/e2e-platform/tree/main); a prepared
full-repository archive contains source and may include a local installation kit.
Git history is available through cloning the repository.
Linux GTK3, Windows UIA/WPF and macOS AX/AppKit reference controls have limited
live qualification, including deliberate wrong-output rejection. These passes
apply to documented profiles and do not certify every framework. Read
[RELEASE_STATUS.md](RELEASE_STATUS.md) for tested scope and remaining release gates.

The fork starts from upstream commit
[`e9c2914`](https://github.com/tester-army/e2e/tree/e9c2914c6d8f8d664d820b13a1fa454e9247e94b), whose committed license is MIT.
It retains that revision's browser/mobile engines and tests. C++ extensions and
selected compatibility/security changes were applied to this MIT source; the
later Apache-licensed upstream tree was not relabeled. See the
[licensing record](docs/development/LICENSING.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

Maintained independently by [Ahmed Aredah](https://github.com/AhmedAredah).
The GitHub fork relationship records source ancestry; it does not imply endorsement
by TesterArmy. The reviewed MIT source is on the default `main` branch. The former
upstream Apache snapshot branch has been removed from this fork. The MIT declaration
applies to this fork's selected source, with separately licensed materials
identified in the notices. It does not relicense
later upstream revisions or third-party dependencies.

## Install and run

Use Node.js **22.22.3+ in the 22.x line, or 24.8.0+**. These fork package names
are candidate package identities; registry publication and namespace ownership are
not established. Install the pinned package manager, then build the checksummed
installation kit from this checkout:

```sh
npm install --global pnpm@12.3.4
git clone --branch main https://github.com/AhmedAredah/e2e-platform.git
cd e2e-platform
pnpm install --frozen-lockfile
pnpm pack:native
```

Use the pinned pnpm version in `package.json`. If you already have a complete
repository archive with `release-packages/`, use its included kit directly:

```sh
# Your project must already have a package.json.
node release-packages/install.mjs /absolute/path/to/your-project
```

The nine-package kit installs `@e2e-platform/core`, five boundary packages, the
shared authoring host and C++/Python adapters. Install the Python SDK wheel
separately; follow [PYTHON.md](PYTHON.md) for a complete first Python test. External
JavaScript dependencies require network access or a populated npm cache. CMake,
compilers, Qt and optional terminal native dependencies are separate prerequisites.
Follow [INSTALL.md](INSTALL.md) for a complete first test, Qt integration
and consumer installation instructions.

Browser and mobile engines are separate optional packages. A Git clone includes
their source; the nine-package kit does not include their tarballs. Follow
[the optional-engine installation steps](INSTALL.md#browser-and-mobile-applications)
to build and pack them locally, install them beside the kit, and prepare browsers
or simulators before running tests.

```ts
import { test, expect } from '@e2e-platform/process/test';

test('prints the correct version', async ({ processes }) => {
  const result = await processes.run({
    executable: '/absolute/path/to/my-application',
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toContain('1.0.0');
});
```

Configure `modelPolicy: 'forbid'` and run `npx --no-install e2e-platform run --no-model`
for deterministic tests. Model-backed operations require an explicitly configured
provider. The fork disables the inherited upstream telemetry transport.

## Modules and extension design

| Module | Responsibility |
| --- | --- |
| `@e2e-platform/core` | Test SDK, engine contract, runner, reports and `e2e-platform` CLI |
| `@e2e-platform/process` | Bounded subprocess execution, streams, cancellation and cleanup |
| `@e2e-platform/cpp`, `native/cpp-sdk` | C++ authored test bodies connected to the shared runner; installed CMake SDK |
| `@e2e-platform/python`, `sdks/python` | Python/pytest authoring, installable typed wheel, owned services and binary I/O |
| `@e2e-platform/authoring` | Shared bounded language host; one scheduler and report model |
| `@e2e-platform/checks` | Independent numeric, JSON and keyed CSV comparisons |
| `@e2e-platform/native` | Native engine, authenticated sidecar profiles, driver and transport abstractions |
| `native/linux-atspi`, `windows-uia`, `macos-ax` | Separately installed Python, C# and Rust accessibility drivers for their respective operating systems |
| `native/qt` | C++ Qt Widgets/Quick bridge, model-item adapters, public custom-control contract and installed CMake package |
| `@e2e-platform/terminal` | Terminal engine, VT state and injectable transport; optional `node-pty` |
| `@e2e-platform/protocol` | Bounded HTTP transport, JSON/status/schema validation |
| `@e2e-platform/playwright`, `agent-device`, `github`, `oauth` | Retained MIT-baseline browser/mobile, reporter and provider integrations |

Abstract classes and injected collaborators separate platform behavior, process
supervision, transport, observation and validation. Extensible launch profiles
distinguish an application from a shared Python or .NET runtime; an owned native
sidecar can use the authenticated native protocol through a protected process
factory. See [LANGUAGES.md](LANGUAGES.md) for the implemented scope and next GUI milestones. Extend the relevant contract
instead of introducing toolkit-specific branches into the runner. See [DESKTOP.md](DESKTOP.md) for driver installation, capabilities and verification limits. The
[support matrix](SUPPORT_MATRIX.md) identifies implemented capabilities and the work
required for GTK, wxWidgets, JUCE, FLTK, ImGui and other frameworks. They do not
currently have dedicated native drivers.

Native locators support scoped composition, state waits and readonly actionability
checks where the backend advertises them. Qt additionally exposes owned-window
selection and toolkit input. OS accessibility backends perform supported semantic
actions and scrolling; they do not provide OS keyboard input or screenshots.
Neither route implies arbitrary canvas controls, Qt WebEngine DOM switching,
native video or visual-regression comparison. See the [release gates](RELEASE_STATUS.md#remaining-release-gates)
for the remaining qualification work.

## Source development

```sh
pnpm install --frozen-lockfile
pnpm check:local
pnpm test
node scripts/native/verify.mjs
# With a matching Qt 6 development kit and runtime modules:
node scripts/native/verify.mjs --qt --require-quick
pnpm verify:qt:install
pnpm verify:qt:exports
pnpm pack:native
node scripts/native/install-kit-smoke.mjs
```

The pinned package manager is pnpm 12.3.4. Full runner/browser integration tests
need the matching Playwright browser installation. Qt checks require CMake 3.21+,
a C++17 compiler and the selected Qt kit. Agent suites need provider credentials
and are manual CI jobs; ordinary C++ checks need no model.

- [Python, C# and Rust integration](LANGUAGES.md)
- [Repository layout and offline setup](OFFLINE_README.md)
- [Verification commands and evidence](verification/README.md)
- [Release status and qualification limits](RELEASE_STATUS.md)
- [Contributing](CONTRIBUTING.md)

`packages/` contains reusable modules, `apps/` private regression applications,
`native/` compiled helpers, `examples/` consumer projects, `docs/` reference pages
and `scripts/` maintenance tooling. Generated reports, build trees and dependencies
are excluded from source; the downloadable kit is an intentional generated artifact.
