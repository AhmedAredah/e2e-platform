# Verify a source checkout

This directory holds the verification guide. Generated logs, reports, screenshots
and installed-consumer fixtures belong in local run output or a separate release
evidence bundle. Results from previous candidates do not qualify this MIT rebuild.
Use [RELEASE_STATUS.md](../RELEASE_STATUS.md) for the current candidate's
recorded checks and qualification limits.

## Prerequisites

Follow [INSTALL_CPP.md](../INSTALL_CPP.md) for consumer installation and
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
pnpm test:cpp
pnpm test:scripts
```

`check:local` runs lint, dead-code checks, builds, type checks, error-code reference
checks and local documentation validation. `pnpm check` uses the same local gate. Mintlify checks are available only through
the explicit docs `check:online` command and require connectivity. Passing local
checks does not establish that browser/mobile integration suites passed.

## Compiled applications and installed consumers

```sh
node scripts/cpp/verify.mjs
node scripts/cpp/verify.mjs --qt --require-quick
pnpm verify:qt:install
pnpm verify:qt:exports
pnpm pack:cpp
node scripts/cpp/install-kit-smoke.mjs
```

The application verifier builds the real examples, runs CTest and the built e2e
CLI, and checks deliberate wrong-output cases. It requires the intended assertion
failure; a timeout, crash, skipped suite or missing dependency cannot pass the
negative test. The final summary must be present and the verifier must exit zero.

The installed Qt check builds both static and shared helpers and compiles a
separate CMake consumer of each installation. `pack:cpp` creates the installation
kit described in [INSTALL_CPP.md](../INSTALL_CPP.md). Test that kit from a separate
project to check the consumer path as well as the source checkout.

| Output | Location |
| --- | --- |
| Combined native verification summary | `.e2e/cpp/verification.json` |
| CLI CTest result | `examples/with-cpp-cli/build/ctest-results.xml` |
| CLI runner reports and exports | `examples/with-cpp-cli/.e2e/` |
| Qt CTest result | `examples/with-qt/build/ctest-results.xml` |
| Widgets and Quick runner reports | `examples/with-qt/e2e/.e2e/` |
| Qt export and masked screenshot proof | `.e2e/cpp/qt-exports/` |
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
