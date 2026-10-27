# Verify a source checkout

This directory holds the verification guide. Generated logs, reports, screenshots
and installed-consumer fixtures belong in local run output or a separate release
evidence bundle. Results from previous candidates do not qualify this MIT rebuild.
Use [RELEASE_STATUS.md](../RELEASE_STATUS.md) for the current candidate's
recorded checks and qualification limits.

## Prerequisites

Follow [INSTALL.md](../INSTALL.md) for consumer installation and
[OFFLINE_README.md](../OFFLINE_README.md) for source dependencies and toolchains.
Source verification needs the pinned pnpm version, a supported Node.js version,
CMake and a C++17 compiler. Qt checks also need the selected Qt 6 development kit
and its runtime modules. Real terminal tests need the optional `node-pty` native
peer. Build the JavaScript packages before invoking scripts that consume `dist`.

## Repository and package checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check:local
pnpm test:native
pnpm test:scripts
```

`check:local` runs lint, dead-code checks, builds, type checks, error-code reference
checks and local documentation validation. `pnpm check` uses the same local gate. Mintlify checks are available only through
the explicit docs `check:online` command and require connectivity. Passing local
checks does not establish that browser/mobile integration suites passed.

## Compiled applications and installed consumers

```sh
node scripts/native/verify.mjs
node scripts/native/verify.mjs --qt --require-quick
pnpm verify:qt:install
pnpm verify:qt:exports
pnpm pack:native
node scripts/native/install-kit-smoke.mjs --kit release-packages
# Requires Python, .NET and Rust installed; no skipped language counts as a pass.
pnpm verify:languages
```

The application verifier builds the real examples, runs CTest and the built e2e
CLI, and checks deliberate wrong-output cases. It requires the intended assertion
failure; a timeout, crash, skipped suite or missing dependency cannot pass the
negative test. The final summary must be present and the verifier must exit zero.

The installed Qt check builds both static and shared helpers and compiles a
separate CMake consumer of each installation. `pack:native` creates the installation
kit described in [INSTALL.md](../INSTALL.md). Test that kit from a separate
project to check the consumer path as well as the source checkout.

| Output | Location |
| --- | --- |
| Combined native verification summary | `.e2e/cpp/verification.json` |
| CLI CTest result | `examples/with-cpp-cli/build/ctest-results.xml` |
| CLI runner reports and exports | `examples/with-cpp-cli/.e2e/` |
| Qt CTest result | `examples/with-qt/build/ctest-results.xml` |
| Widgets and Quick runner reports | `examples/with-qt/e2e/.e2e/` |
| Qt export and masked screenshot proof | `.e2e/cpp/qt-exports/` |
| Three-language scenario and cleanup summary | `.e2e/languages/verification.json` |
| Language runtime/build fingerprints | `examples/with-languages/build/runtime-manifest.json` |
| Generated consumer installation kit | `release-packages/` |

## Record the tested environment

Record the source commit, Node and package-manager versions, OS/architecture,
compiler, CMake, Qt kit and display backend with each release's evidence. Keep
positive and deliberate negative reports distinguishable. Preserve the command's
exit status and summarize any skipped or unavailable checks.

Re-run the required CI matrix on each supported platform. Offscreen Qt results do
not establish physical desktop input, X11/Wayland, GPU or native-dialog behavior.
Keep generated output outside tracked source; include only the current evidence
needed to review a release in its separate evidence bundle.


## Desktop accessibility drivers

The current candidate is `e2e-platform` 0.2.0-rc.6. Start with
[DESKTOP.md](../DESKTOP.md) and the [declared profiles](../docs/development/support-profiles.json).
Driver tests and native acceptance instructions live with each implementation:
Python [AT-SPI](../native/linux-atspi/README.md), C# [UIA](../native/windows-uia/README.md),
Rust [AX](../native/macos-ax/README.md), C++ [Qt](../native/qt/README.md).

`E2E_TEST_PYTHON=/usr/bin/python3 pnpm --filter @e2e-platform/native test` additionally
runs the actual Python protocol host with an injected provider through the shared
runner. This tests interoperability, not a live GTK desktop. Native graphical
checks must run on eligible hosts and fail when unavailable. Do not count fake
providers, cross-compilation or configured CI jobs as platform certification.

Run builds before integration tests, and do not clean/rebuild shared `dist` directories
while those tests are in flight. One qualification attempt here was invalidated
by a concurrent build; a later isolated full run passed all 163 core files.
