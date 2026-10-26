# Working with the complete checkout

This archive contains the MIT upstream source snapshot and its fetched ancestry,
the reviewed C++ extension port, tests, examples and documentation. The current
development branch is `fix/release-hardening`. The base is commit
`e9c2914c6d8f8d664d820b13a1fa454e9247e94b`; later Apache-licensed upstream
commits are not this fork's base. Nothing has been published or pushed upstream.

Start with [CPP_SUPPORT.md](CPP_SUPPORT.md) for the support matrix and extension
architecture, [native/README.md](native/README.md) for adding native helpers, and
[verification/README.md](verification/README.md) for verification commands.
[RELEASE_STATUS.md](RELEASE_STATUS.md) records the current candidate's results and
qualification limits. Detailed release evidence is provided separately from the
source archive; older evidence remains in Git history and previous archives.
The archive also includes a generated, checksummed `release-packages/` install kit.
See [INSTALL_CPP.md](INSTALL_CPP.md) for using it in another project.
The new packages are workspace source packages; their inclusion does not mean
that these package versions have been published to a registry.

## Folder guide

| Location | Purpose |
| --- | --- |
| `packages/` | Reusable TypeScript modules prepared for packaging, public contracts and their tests. The C++ additions are process, checks, native, terminal and protocol. |
| `native/qt/` | C++ Qt helper, installed headers, internal adapters/protocol, CMake configuration and compiled tests. Future toolkit helpers belong beside it. |
| `examples/` | Standalone consumer examples, including C++ CLI/Qt and Python, C# and Rust CLI/HTTP applications. |
| `apps/` | Upstream testbed and browser/mobile benchmark applications used to qualify the shared runner. |
| `docs/` | Documentation pages, checked code examples and required site assets. |
| `scripts/` | Build, validation and release tooling; C++ verification and installation tooling is under `scripts/cpp/`; language build and verification scripts are under `scripts/languages/`. |
| `skills/` | Consumer integration guidance bundled with the core package. |
| `verification/` | Stable instructions for reproducing checks; generated run evidence is kept outside tracked source. |
| `release-packages/` | Generated, checksummed local installation kit included with the downloadable archive. |

Upstream web/mobile modules, benchmark fixtures and documentation assets remain
part of this repository because the shared runner and its regression tests use
them. Source archives exclude local dependencies, compiled build trees, caches
and run output. The installation kit is the deliberate generated-file exception.

## Open and inspect

Extract the entire archive, including its `.git` directory. Open the extracted
`e2e-cpp` folder in your editor. Git needs no network connection for these steps:

```sh
git status
git log --oneline -10
git branch -a
git fsck --full
```

No writable upstream remote is configured for this fork. Adding a remote and
fetching or pushing are separate maintainer actions that require connectivity. If Git reports a safe-directory warning
because extraction changed ownership, apply your normal local Git ownership
policy to this checkout.

## Prepare dependencies before disconnecting

The archive is a complete **source repository**, not a preinstalled SDK image.
It excludes generated build trees, `node_modules`, package-store caches,
downloaded browsers, Qt installations and compiler toolchains. These depend on
your OS and architecture. Provision them on the machine where tests will run:

1. Install a compatible Node.js release and the `pnpm` version pinned in the
   root `package.json`.
2. Install CMake 3.21 or newer and a C++17 compiler. For Qt, install a matching
   Qt 6 development kit with Widgets, Network and Test; add Quick, QML, Quick
   Controls, Quick Layouts and their runtime modules for the Quick example.
3. While online, run `pnpm install --frozen-lockfile` and `pnpm build`. Optional
   PTY support uses the `node-pty` peer dependency and may need Node headers and
   native compilation. Provision native build prerequisites before disconnecting.
4. Install any browser/mobile engines and platform dependencies required by
   the existing upstream examples you intend to run. The C++ CLI and cooperative
   Qt examples do not require a browser download.
5. For the language examples, provision Python 3.12+, the .NET 10 SDK and a
   compatible Rust/Cargo toolchain before disconnecting. See [LANGUAGES.md](LANGUAGES.md)
   for explicit tool paths and the versions actually qualified. The included demos
   use no third-party Python, NuGet or Cargo packages.
6. Keep the resulting dependency store and SDK installations locally. A later
   reinstall can use `pnpm install --offline --frozen-lockfile` only if the store
   already contains everything needed for that platform. Native install scripts
   can still need locally cached toolchains or headers.

Installed packages alone do not make a model-backed run offline. Use the
deterministic tests or `--no-model` when provider access must be forbidden.
Model-dependent operations without usable replay data will fail explicitly.

## Build and verify

From the repository root, after installing dependencies:

```sh
pnpm build:cpp
pnpm test:cpp
node scripts/cpp/verify.mjs
node scripts/cpp/verify.mjs --qt --require-quick
```

The last command requires the selected Qt kit and a suitable graphical backend.
Set `CMAKE_PREFIX_PATH` if necessary. Linux offscreen runs can exercise helper
semantics with `QT_QPA_PLATFORM=offscreen`; they do not qualify desktop input,
window-manager behavior or GPU rendering. See the Qt README for kit compatibility.

The verifier compiles the applications, runs CTest, invokes the built e2e runner
and checks both passing workflows and deliberately incorrect output. Its planted
negative test is expected to fail with the intended assertion; the verifier
itself succeeds only when that failure is correctly identified.

Use [RELEASE_STATUS.md](RELEASE_STATUS.md) and the separate release evidence for the
environment actually checked. Re-run the commands in
[verification/README.md](verification/README.md) on your own target OS, compiler
and Qt kit before treating that combination as supported.
