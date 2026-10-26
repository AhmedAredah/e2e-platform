# MIT rebuild release status

This is the **0.1.0 MIT-based fork candidate**, rebuilt from upstream commit
`e9c2914c6d8f8d664d820b13a1fa454e9247e94b`. Validation from earlier Apache-based
archives is not reused as evidence. Consult the current validation record delivered
with this candidate and reproduce its checks using [verification/README.md](verification/README.md).

The source license/provenance boundary is documented in
[LICENSING.md](docs/development/LICENSING.md). Dependency and toolkit licenses
remain separate, as described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The `@e2e-cpp` names and 0.1.0 versions identify the local fork installation kit;
no registry publication, namespace ownership or signed release is claimed.

## Recorded validation — October 24, 2026

Validated on Linux x64 with Node 24.22.1, pnpm 12.3.4, GCC 13.3,
CMake 3.28.3 and Qt 6.4.2 using the offscreen backend. These results apply to
this MIT rebuild. Test groups overlap; their counts must not be added into a
single claimed number of unique tests.

| Check | Result |
| --- | --- |
| `pnpm check:local` | Passed: lint, dead-code gate, all 10 public builds, workspace type checks, 76 documented error codes, 7 embedded examples and 44 documentation pages. |
| Core unit suite | 1,474 passed; 3 conditional filesystem tests skipped (two permission checks under root and one case-insensitive filesystem check). |
| Core integration selections | 55 focused checks, 63 additional browser-free checks and 6 independent ordinary/serial cleanup/cache checks passed. These selections overlap other targeted coverage. |
| Security regression selection | 144 checks across 14 files passed, including actual compiled CLI output and cross-worker secret restoration. |
| C++ extension packages | Process 23, checks 14, HTTP protocol 16, native 32 and terminal 32 passed; terminal coverage includes a real PTY. |
| Maintenance script tests | 18 passed. |
| Retained package tests | Playwright 171 unit checks; agent-device 92, GitHub reporter 19 and OAuth 52 passed. Five simulator tests skipped. |
| Real application workflows | C++ CLI 3, Qt Widgets 3 and Quick 1 passed; the CLI and Widgets planted defects failed with the required assertions. Final verifier exited zero and wrote its complete summary. |
| Compiled C++/Qt tests | CLI 3/3 CTest checks; static Widgets/Quick 3/3 suites (54 QTest cases); hidden-visibility shared Widgets 2/2 suites (38 cases). |
| Installed Qt helper | Separate static and shared CMake consumers built, linked and ran; installed license/third-party files verified. |
| Qt export oracle | Correct 82.5 result accepted, planted 83.5 rejected; masked screenshot evidence checked. |
| Packed six-module consumer | Checksums, paths containing spaces/ampersands, npm install and clean reinstall, actual CLI shim, imports, passing and planted-failure tests, license metadata and strict public TypeScript compilation passed. |
| Consumer dependency audit | Zero reported vulnerabilities across 162 dependencies, including the tool's development dependencies. Lockfiles and audit JSON retained in the separate evidence bundle. |
| Source provenance | MIT base and all 174 imported file origins verified; final similarity screen and its limitations recorded in `docs/development/licensing-audit.json`. |

The first aggregate Qt run encountered a generated Widgets executable without
execute permission. Restoring that generated file's mode allowed the unchanged
source to pass; the cause was not established. The final full verifier passed.

The complete browser integration suite was **not** qualified: browser downloads
returned invalid/truncated archives. Simulator/device and live provider checks,
Windows/macOS runtime checks and signed/public distribution were not performed.
Local checks do not substitute for these environments.

## Qualification boundaries

- The C++ CLI, cooperative Qt Widgets/Quick and terminal engines must be qualified
  on the target operating system, toolchain and toolkit combination. Linux
  offscreen results do not establish Windows/macOS, physical input, Wayland,
  compositor, GPU, accessibility, native-dialog or arbitrary custom-control support.
- Browser/mobile sources and regression tests from the MIT base are retained.
  Simulator/device, provider-backed and operating-system-specific checks need
  their own environments; a configured CI job is not a recorded pass.
- Qt helper use is opt-in for test builds. Qt and its modules have their own
  LGPL/GPL/commercial choices and distribution obligations.
- The archive contains source and a local npm installation kit, not an offline
  dependency cache, compilers, Qt SDKs, browsers or native terminal prebuilds.

## Dependency audit

Compatible dependency updates address advisories in the reusable C++ package
runtime and retained web app. The private Expo mobile showcase still depends on
upstream packages with three unresolved advisories: `node-forge` (high), Zod 3
(high) and `decode-uri-component` (moderate) through a CommonJS `query-string` dependency. No major
version substitution was applied merely to silence the audit. In particular,
`decode-uri-component` 0.5 is ESM-only and is not a compatible replacement for
that caller; forcing Zod 4 into an API expecting Zod 3 is also unsafe.

These private showcase dependencies are not part of the six-package C++ install
kit. Run both `pnpm audit --prod` for the full workspace and `npm audit --omit=dev`
or the corresponding production audit in a dedicated runtime consumer to assess
actual distribution dependencies. When installing the kit as development
dependencies, use `npm audit` without `--omit=dev` to include the tested tools.
Audit results are time-sensitive; preserve the report date and lockfile.
