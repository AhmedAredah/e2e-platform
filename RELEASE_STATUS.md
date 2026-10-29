# e2e-platform 0.2.0-rc.8

This is a reviewed **prerelease**, not a fully qualified stable release. The nine-package local kit uses `0.2.0-rc.8` and `@e2e-platform/*`; four optional
integrations retain their compatible `0.2.0-rc.7` versions. The executable
and repository folder are `e2e-platform`. Tests use TypeScript/JavaScript or the
bounded C++ and Python/pytest authoring bridges connected to the shared runner.
C# and Rust authoring SDKs are not included. The application under test can use Python, C#/.NET, C++, Rust or
another language; GUI support depends on accessible controls and the driver.

The [C++ review resolution record](docs/development/CPP_REVIEW_RESOLUTION.md)
tracks all 27 findings. Those reviewed C++/Qt blockers have fixes and passing hosted evidence,
including the formerly failing macOS Quick profile. Older checkpoints below are
historical; each qualification below identifies its exact tested source.

## Qt/Cocoa shutdown correction

The shutdown heap corruption is corrected at
[`5fc0c237fe7182e89ada43a171ab477ed8fa5d75`](https://github.com/AhmedAredah/e2e-platform/commit/5fc0c237fe7182e89ada43a171ab477ed8fa5d75),
with orderly acknowledgement draining added at
[`06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05`](https://github.com/AhmedAredah/e2e-platform/commit/06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05).
The bridge now disconnects and closes its sockets before destroying connection
state. The actual Quick fixture reproduced SIGABRT in three unchanged-runtime
Cocoa probes, including an LLDB capture. The completed correction passes 60/60
macOS Cocoa shutdown cycles, both protocol variants and Quick controls in
[run 40886089024](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886089024).
Local Linux validation passed 100/100 cycles for the lifetime correction, then
60/60 cycles and all five CTest suites for the completed correction.
The native Cocoa release gate now includes this repeated lifecycle regression.
See the [resolution record](docs/development/QT_COCOA_SHUTDOWN_RESOLUTION.md)
for the ownership defect, verified artifact digests and rebuild instructions.

All **48 required pull-request jobs across eight workflows passed** for the
completed correction, including all nine native jobs and all 25 Python jobs.
The PR checkout `6b96b6b79a08be53367f0be109533873a2b86b4a` has the same tree as
the final source head `06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05`.
The [native matrix](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097677)
passes Windows native/offscreen, Linux X11/offscreen and macOS Cocoa/offscreen,
including installed SDKs and static/shared Qt consumers. The optional live-model
benchmark was not invoked. The linked resolution record lists every workflow
and the exact downloaded Cocoa and Windows evidence digests.

## Comprehensive qualification before the shutdown correction

All **47 required jobs across seven workflows passed** on the first attempt for
[`6494472ac1382a968ca1a4b92241682a323b3b81`](https://github.com/AhmedAredah/e2e-platform/commit/6494472ac1382a968ca1a4b92241682a323b3b81),
recorded 2026-10-28. This includes every previously pending macOS Python job.
The Python wheel and nine-package kit are installable from source; no stable
release or registry publication is declared.

| Workflow | Required jobs passed | Verified scope |
| --- | --- | --- |
| [python](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513854) | 25 / 25 | Python 3.11–3.15 installed consumers on three OS, minimum pytest, real Flask/Django/FastAPI and PySide6/PyQt6 Widgets/Quick |
| [desktop-contracts](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513683) | 5 / 5 | Real GTK3/WPF/AppKit plus installed TypeScript/C++/Python consumers |
| [native](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724514128) | 9 / 9 | C++ CLI/HTTP, Qt Widgets/Quick, installed SDK and static/shared helper consumers |
| [languages](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513585) | 3 / 3 | Python/C#/Rust CLI/HTTP positive and planted-negative cases on three OS |
| [spec](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513825) | 3 / 3 | Quality gate, testbed and Node 22.22.3/24.22.1 suites |
| [docs](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513948) | 1 / 1 | Local documentation validation |
| [benchmark](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513787) | 1 / 1 | Deterministic browser; optional live-model job not invoked |

All 39 Python, desktop, native and language evidence archives were downloaded.
Their SHA-256 digests, source identities, 315 reports and Python wheel checksums
were verified. The reports contain no retries, incomplete cleanup or secondary
errors. Positive cases passed; planted defects failed their independent oracles.
See the [Python resolution record](docs/development/PYTHON_REVIEW_RESOLUTION.md)
and [machine-readable evidence](docs/development/support-profiles.json) for
runtime versions, artifact identities and support boundaries.

An intermittent C++ Qt/Cocoa shutdown crash was discovered separately. In the previous
`0e9ae2d` run, the planted Quick calculation failed correctly, then the application
aborted with `SIGABRT` during cleanup. The later successful run does not explain
or fix that failure. The original diagnostic probed a different executable and
retained no original crash stack. The follow-up now collects recent macOS crash
reports for the known Qt fixtures and passes three portable collector regressions
and all 75 maintenance tests. That diagnostic-only checkpoint did not change
runtime behavior or relax negative tests. The later correction and reproduced
crash evidence are recorded above. This is separate from the passed Python Qt/AX profile.

The 47-job checkpoint above predates the runtime correction; it is retained
as exact historical evidence, not relabeled as a run of the corrected source.

## Previously qualified code checkpoint

All 22 required jobs across six workflows passed on their first attempt for
[`c0d0bdfcf85676ec2ec7345bfe250ce12fe185bb`](https://github.com/AhmedAredah/e2e-platform/commit/c0d0bdfcf85676ec2ec7345bfe250ce12fe185bb).
The optional live-model job was not invoked. This final documentation update
records the qualified code; it changes no production source.

| Workflow | Required jobs passed | Scope |
| --- | --- | --- |
| [spec](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827476) | 3 | Quality gate, testbed and Node 22.22.3/24.22.1 suites |
| [native](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827714) | 9 | C++ CLI/HTTP, installed SDK/kit, Qt Widgets/Quick and static/shared consumers |
| [desktop-contracts](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827574) | 5 | GTK3, WPF and AppKit real controls and installed TypeScript/C++ consumers |
| [languages](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827437) | 3 | Python/C#/Rust CLI/HTTP positive and planted-negative cases on three operating systems |
| [benchmark](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827618) | 1 | Deterministic browser benchmark; optional live-model job not invoked |
| [docs](https://github.com/AhmedAredah/e2e-platform/actions/runs/40628827596) | 1 | Local documentation validation |

The native Cocoa artifact explicitly records
`PASS : WidgetsControlsTests::fillingReactivatesBackgroundApplication()`; the
regression ran rather than being skipped. All eight installed static/shared
Widgets/Quick positive and planted-defect cases passed their required oracles
with complete cleanup. The three OS desktop archives likewise record all twelve
installed TypeScript/C++ cases with completed cleanup. Their archive bytes,
SHA-256 digests and exact source commits were verified. Artifact identifiers and
digests are recorded in [support-profiles.json](docs/development/support-profiles.json).

## Installation kit and dependency follow-up

Packing now invalidates the previous manifest and source marker before any build
or package checks. A failed attempt cannot retain a stale installable kit. The
new manifest is published atomically after all nine tarballs and installer
checksums exist. This applies to `pnpm pack:native`, `pnpm release` and direct
packing into a custom output directory.

Four regressions cover build/check failures with default and custom paths. The
local quality gate, 72 maintenance tests, rebuilt nine-package kit and fresh
consumer installation/reinstallation passed. The installed dependency audit again
reported zero findings. The compatible `node-forge` 1.4.2 and
`postcss-selector-parser` 6.1.5 overrides passed Expo certificate/signature checks
and Tailwind selector/CSS generation, respectively. These checks do not qualify
an Expo device or the complete hosted Mintlify preview.

The [current dependency inventory](docs/development/dependency-audit-current.json)
binds the audit to the lockfile SHA-256 and records the remaining findings and
upgrade constraints. The exact hosted runtime checkpoint below remains historical
evidence; packaging changes require their own CI results.

The first hosted run for `e0b3e186e6cf09cc568aa9121b6701160bb08969` passed 21
required jobs and failed the Cocoa Qt installed-consumer job on window activation.
The resulting correction raises an inactive Widgets window before requesting
activation, and adds a Cocoa regression using a separate owned foreground process.
It retains the refusal to type without observed activation. The original failure
and follow-up are recorded in the [resolution report](docs/development/CPP_FOLLOWUP_RESOLUTION.md);
the corrected native source passed the exact-commit qualification above.

## Previous C++ follow-up qualification

All 22 required jobs across six workflows passed on 2026-10-27 for code checkpoint
[`9c0bf5eb63d85088e318395be6e6010ab88a1d0a`](https://github.com/AhmedAredah/e2e-platform/commit/9c0bf5eb63d85088e318395be6e6010ab88a1d0a).
The optional live-model benchmark was not invoked. These results qualify the
named reference applications, controls and display backends. This documentation
records that exact code checkpoint; it does not treat later source changes as tested.

The seven review findings and additional hosted integration corrections are
tracked in [CPP_FOLLOWUP_RESOLUTION.md](docs/development/CPP_FOLLOWUP_RESOLUTION.md).
They cover exact C++ HTTP JSON parsing, strict host JSON, identity-bound password
protection, Windows option preflight, Qt scroll postconditions, run-local desktop
exclusion, `qs` 6.16.1, macOS accessibility startup and installed assertion deadlines.

| Workflow | Required jobs passed | Verified scope |
| --- | --- | --- |
| [spec](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128536) | 3 | Quality gate, testbed, Node 22.22.3 and 24.22.1 unit/integration suites |
| [native](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128829) | 9 | C++ CLI/HTTP, installed SDK and kit, Qt Widgets/Quick, static/shared consumers, exports and masked capture |
| [desktop-contracts](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128250) | 5 | Real GTK3/WPF/AppKit, installed TypeScript/C++ consumers, owned cleanup and Windows Job Object |
| [languages](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128390) | 3 | Python/C#/Rust CLI/HTTP positive and planted-negative scenarios on three operating systems |
| [benchmark](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128694) | 1 | Deterministic browser benchmark; optional live-model job not invoked |
| [docs](https://github.com/AhmedAredah/e2e-platform/actions/runs/40575128234) | 1 | Local documentation validation |

The desktop acceptance installs the public packages and CMake SDK into a fresh
consumer project. Both TypeScript and compiled C++ pass the real GTK/WPF/AppKit
workflow, reject the independent planted wrong result at the intended assertion,
and complete owned cleanup. The three evidence archives were downloaded and
verified against their SHA-256 digests and source commit. Their identities are in
[support-profiles.json](docs/development/support-profiles.json).

The installed seven-package consumer kit passes its production dependency audit
with zero findings. Optional docs/demo dependency findings and registry/publication
gates remain documented below. No stable release or registry publication is claimed.

## Previous hosted evidence

Recorded 2026-10-27. All 21 required jobs across five workflows passed at
`4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; one optional live-model job was
not invoked. A pass is limited to the named applications, controls, kits and
display backends. The seven-package consumer kit is independently checksummed and
smoke-tested; no registry publication or stable release tag has been created.

| Scope | Source and hosted result |
| --- | --- |
| Full quality gate, testbed, unit/integration suites and Chrome/CDP; Node 22.22.3 and 24.22.1 | `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; [spec](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293662), all three jobs passed. |
| C++ command, SDK and clean seven-package installation on Ubuntu 24.04, Windows Server 2022 and macOS 15 | `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; [native](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293679), all nine jobs passed. |
| Qt Widgets/Quick, installed C++ authored tests, static/shared consumers, export and masked capture | Same native run: Qt 6.4.2 Linux x86_64 offscreen/X11; Qt 6.8.3 Windows x86_64 offscreen/native Windows style; Qt 6.8.3 macOS arm64 offscreen/Basic and Cocoa/macOS style. |
| Linux GTK3 and Windows UIA/WPF real controls, independent wrong-output rejection and owned cleanup | `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; [GTK3](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293705/job/122176012218) and [WPF](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293705/job/122176011950) passed. |
| Windows Job Object ownership and actual TypeScript supervisor client | Same checkpoint; [Windows process job](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293705/job/122176012371) passed. |
| Python/C#/Rust CLI and HTTP positives and deliberately wrong results, three operating systems | `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; [languages](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293733), all three jobs passed. |
| Retained deterministic browser benchmark | Same checkpoint; [benchmark](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293497) passed; optional model job was not invoked. |
| macOS AX/AppKit, all eight advertised operations, real scroll viewport, selection forms, wrong-output rejection and cleanup | `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`; [AppKit](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293705/job/122176012450) passed; all five jobs in that desktop run passed. |

The original macOS Quick failure was diagnosed with LLDB in Qt's native style
rendering through the offscreen backend. Headless tests now select Basic, and a
separate Cocoa/native-style job preserves native-style coverage. Both passed.
The helper does not override the consuming application's style. Native-window
actions confirm activation before typing; asynchronous close tests await the
read-only failure latch. No failing Quick tests were skipped.

## Current implementation and evidence boundaries

The current work adds scoped native locator composition, explicit state waits,
readonly actionability preflight and custom fixture context. A mutating action is
sent once; uncertain outcomes remain terminal for the attempt. OS providers add
semantic scroll-to-visible operations, consistent common roles and safer state
observation. AX selection is limited to writable AXSelectedChildren and unique
direct children. Unknown AX visibility cannot prove visible, hidden or absence;
unknown enabled/focused states cannot pass positive or negated assertions.

Qt adds a public source-level custom-control adapter contract, selected Widgets
model/view controls, menus/tabs/headers and owned-window enumeration/activation.
Custom adapters disable screenshots until their masking/capture behavior can be
qualified. C++ authored test bodies use the separately installed CMake SDK and
`@e2e-platform/cpp`; the shared runner retains scheduling, lifecycle and reports.
The C++ and Python/pytest bridges do not claim full TypeScript API parity.
C#/xUnit and Rust/Cargo test-authoring SDKs remain future work.

Process fixtures add tracked asynchronous operations, safe run diagnostics and
supervised services with explicit readiness. Application state reset remains a
test fixture responsibility. The optional Windows Job Object supervisor is a
separate native component, not a silent upgrade to default taskkill behavior.

Local follow-up OS-driver checks pass 86 Python tests, 81 portable UIA checks and
38 Rust tests. Native hosted results above are separate from portable tests.
The local nine-package kit passes manifest integrity, clean install/reinstall,
plain Node imports, strict public types, initializer/first test, deliberate failure
rejection, metacharacter paths and conventional npm launch paths. Its installed
production dependency audit reports zero findings. Default Windows taskkill and
npm shim limitations remain documented; the explicit Job Object helper and direct
Node command are available for their respective cases.

## Publication state

[AhmedAredah/e2e-platform](https://github.com/AhmedAredah/e2e-platform) was created
as a real GitHub fork of TesterArmy e2e. Issues and private vulnerability reporting
are enabled. The reviewed candidate source and default branch are
[`main`](https://github.com/AhmedAredah/e2e-platform/tree/main).
The reviewed MIT source is now on `main`; the former upstream Apache snapshot
branch has been removed from this fork.
No GitHub release, npm publication or registry namespace ownership is claimed.
Hosted CI results are recorded in [GitHub Actions](https://github.com/AhmedAredah/e2e-platform/actions).
Clone `main` or use the reviewed full-repository archive.
[Publishing instructions](docs/development/PUBLISHING.md) update the reviewed
`main` branch without a force push.

The selected MIT base remains
`e9c2914c6d8f8d664d820b13a1fa454e9247e94b`. The review retained upstream and Pi
attribution, identified the Code of Conduct's separate CC BY 4.0 terms, removed
an optional skill with uncertain external licensing, and replaced upstream
branding. MIT applies to the reviewed covered source, subject to original-work
rights and separately identified materials. See [licensing](docs/development/LICENSING.md)
and [third-party notices](THIRD_PARTY_NOTICES.md); the fork network and dependencies
are not declared MIT-only.

## Release review changes

- Clean up owned POSIX descendants even after their command leader exits.
- Serialize MCP startup and teardown, clean up failed standalone startup, and
  reject cancelled fixture requests before dispatching to an engine.
- Treat unavailable semantic fields as unknown in positive and negated assertions.
- Omit oversized browser and terminal fields whole to prevent partial-secret leaks;
  reject malformed UTF-8 at native RPC and HTTP JSON boundaries.
- Preserve detected password sensitivity in Qt and Windows UIA after reveal toggles.
  Reject redirected Quick keyboard focus and ambiguous or disabled Widgets options.
- Close AT-SPI sessions after uncertain mutations, revoke stale references after
  failed snapshots, and account for JSON escaping in macOS response budgets.
- Recognize Android password metadata and withhold mobile screenshots containing
  secure controls; asynchronous accessibility rectangles cannot guarantee safe masks.
- Sanitize GitHub error responses and OAuth credential parsing errors.
- Correct repository metadata, CI action commits, supported hosted runner versions,
  hidden report uploads, package notices, installer integrity and onboarding.

The object-oriented driver, transport, process and control interfaces remain
separate. OS sidecars are Python (Linux), C# (Windows), and Rust (macOS); the
cooperative Qt bridge is C++. These are platform implementations. The separate
C++ authoring bridge provides a bounded SDK, not four independent full runners.

## Recorded rc.3 checkpoint

The source checkpoint is
[`3baeb8d6bd90b799f7784e67e24c9922d5e27b2f`](https://github.com/AhmedAredah/e2e-platform/commit/3baeb8d6bd90b799f7784e67e24c9922d5e27b2f).
Local Linux checks before that commit passed 38 process tests (one Windows-only
regression skipped), 80 native package tests, 68 Python AT-SPI portable tests and
55 maintenance-script tests. Lint, the dead-code gate, workspace typechecks,
76 error-code references, 7 embedded examples and 47 documentation pages passed.
The rc.3 six-package kit passed clean installation/reinstallation, default
initialization, deterministic execution, deliberate wrong-output rejection,
plain Node imports, public API typechecking and the installed-dependency audit.
The logs identify the tested working tree; these local results do not establish
Windows or macOS GUI behavior.

On 2026-10-27, hosted
[`desktop-contracts` run 40429517430](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517430)
passed all four jobs at that exact source checkpoint:

| Hosted profile | Result and limits |
| --- | --- |
| Ubuntu 24.04 / AT-SPI | Shared-runner/Python interoperability, 68 portable tests and the real GTK3 accessible-controls acceptance test passed under D-Bus/Xvfb. This qualifies the reference controls and deliberately wrong-output rejection, not every Linux toolkit or display session. |
| Windows Server 2022 / UIA | 39 portable protocol checks, the UIA driver build and WPF fixture build passed on Windows. The interactive UIA/WPF acceptance test was not run. |
| macOS 15 / AX | 23 portable Rust tests and the real AppKit fixture build passed on macOS; the Rust tests also passed on Ubuntu 24.04. The interactive AX/AppKit acceptance test was not run. |

The same source checkpoint passed
[`docs` run 40429517498](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517498)
and [`benchmark` run 40429517568](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517568).
This is not an all-CI pass: the
[`native` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517414)
and [`languages` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517651)
reported failures requiring follow-up. The
[`spec` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517523)
failed on Node 24 because startup diagnostics could be read before redacted
output finished draining; Node 22 and source-quality jobs passed. The rc.4
changes address these failures. Later source changes require their own recorded results.

## Recorded rc.4 checkpoint

On 2026-10-27, source checkpoint
[`50e3a377f0299f73a0472a012f85a893f7cb8c5d`](https://github.com/AhmedAredah/e2e-platform/commit/50e3a377f0299f73a0472a012f85a893f7cb8c5d)
passed the hosted
[`spec` run 40431659284](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659284)
on Ubuntu 24.04 with Node 22.22.3 and 24.22.1. Each Node job passed all 260
Playwright tests across 28 files, including all 3 CDP attach and 15 CDP recovery
tests. This resolves the earlier local CDP socket blocker for that hosted profile;
it does not qualify every browser or operating system.

The same checkpoint passed
[`languages` run 40431659168](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659168)
on Ubuntu 24.04, Windows Server 2022 and macOS 15: each platform passed nine
Python/C#/Rust CLI/HTTP scenarios and rejected all six planted defects. Its
[`desktop-contracts` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659315),
[`docs` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659217)
and [`benchmark` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659286)
also passed, with the same interactive UIA/AX and live-provider limits above.
This was not an all-CI pass:
[`native` run 40431659232](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659232)
failed in the Windows and macOS package tests; its Linux command and Qt jobs
passed. Follow-up source changes require their own completed qualification.

## Historical rc.2 verification baseline

The following detailed review ran against **0.2.0-rc.2**, before the rc.3 changes,
on the available Linux x64 environment. It is retained as historical evidence,
not presented as a rerun against the current candidate. Detailed logs, command records, intentional
failures and hashes accompany the rc.2 validation bundle. Earlier unsuccessful
runs are retained and clearly superseded by the qualified rc.2 reruns.

| Area | Result and limits |
| --- | --- |
| Core unit/integration | 1,891 passed; 163 test files; 3 unchanged filesystem/root-environment skips; 0 failures. |
| Application boundaries | Native 80, process 36, checks 17, HTTP 17, terminal 39 passed. Native includes real Python protocol-host interoperability with a fake accessibility provider. |
| Browser subset | 242 passed across 26 files; only CDP attach/recovery files excluded for the established host socket restriction. |
| Retained integrations | Mobile 91 passed and 5 simulator skips; GitHub 20 passed; OAuth 64 passed using mocks. |
| Linux AT-SPI | 63 portable tests, wheel integrity and clean offline wheel installation passed; live D-Bus unavailable. |
| Windows UIA | 39 portable checks; driver and WPF fixture cross-compiled with zero warnings/errors. No Windows GUI run. |
| macOS AX | 23 portable tests; Rust formatting and driver/AppKit FFI typechecks passed. No Apple framework link or macOS GUI run. |
| Qt 6.4.2 | Fresh Linux GCC build: 5 CTest suites / 114 rows. Widgets-only build: 4 suites passed. Installed CMake consumer passed. |
| Qt runner | Widgets 3/3 and Quick 1/1; both planted negatives failed with ASSERTION_FAILED; all 8 attempts completed cleanup. Offscreen/software backend only. |
| Language applications | Python/C#/Rust: 9 CLI/HTTP positives passed; 6 planted defects rejected; cleanup complete. C++ CLI: 3 positives and its planted defect passed the verifier. |
| Maintenance scripts | 55 tests passed. |
| Exact installed six-package kit | Install and npm ci, default initializer/first test, plain Node imports, strict API types, notices, tamper checks and planted-failure verdict passed; zero reported installed-dependency vulnerabilities. |
| Source quality | Lint, dead-code gate, all ten builds, workspace typechecks, 76 error-code references, 7 embedded examples and 47 documentation pages passed. Dead-code tooling retains 12 advisory class-member warnings. |

The historical validation summary links the exact rc.2 consumer-kit and browser
reports. The prepared rc.2 full-repository bundle contained tracked source and Git history
plus a checksummed six-package JavaScript install kit. The rc.7 kit added the
C++ bridge; rc.8 adds the shared authoring host and Python adapter for nine
packages. A normal GitHub source ZIP contains neither
Git history nor the generated kit. SDKs, Qt, browser binaries, OS libraries and
package-manager caches remain external prerequisites.

## Dependency findings

The latest pinned-pnpm full-workspace audit reports **10 findings: 7 high,
1 moderate and 2 low**. The working baseline reported 12 after a newly reported
`deepmerge` advisory; compatible overrides for `node-forge` 1.4.2 and
`postcss-selector-parser` 6.1.5 removed two. The earlier `qs` 6.16.1 fix remains.

Every remaining path is in optional Mintlify preview/online-validation tooling
or the private Expo benchmark. The production-only workspace audit includes
private apps and reports 3 findings: Zod 3 (high), decode-uri-component (moderate)
and deepmerge (low). The fresh installed nine-package kit reports zero findings.
See the [current inventory](docs/development/dependency-audit-current.json) for
versions, advisory URLs, affected scopes and the lockfile hash. The
[rc.2 inventory](docs/development/dependency-audit-rc2.json) remains historical.

Some findings have no published fix; others require dependency-line migrations
and runtime qualification. No advisory is suppressed to obtain a passing result.
Four optional docs/Expo peer conflicts also remain. Local documentation checks do
not run Mintlify. Do not represent the whole workspace, docs host or Expo demo as
vulnerability-free or fully qualified.

## Remaining release gates

The documented C++/Qt, Linux GTK3 and Windows WPF reference profiles have the
hosted evidence listed above. Every additional framework, toolkit version and
display backend requires its own real-control test. macOS AX/AppKit acceptance
also passed, including the application-owned optional scroll/selection controls. The manual release workflow reruns the complete
quality, native, language, Python and desktop gates before creating an installation kit.

Mobile simulator/hardware and live model-provider qualification remain outside
this candidate's verified scope. Generic custom-painted controls, global OS input,
OS-sidecar screenshots, native video, visual diffs and integrated native/DOM
switching are not implemented. C#/Rust test-authoring SDKs remain future
extensions; these application languages already work through the shared runner.

| Gate | Requirement before publication or a broader support claim |
| --- | --- |
| Exact distribution | Rebuild/checksum and smoke-test the final kit; run the complete release workflow against its selected commit. No stale success aggregates are accepted. |
| Additional toolkits/platforms | Add real controls and positive/negative acceptance for each claimed combination. Existing reference passes are not universal framework certification. |
| Optional docs/Expo tooling | Resolve or explicitly assess remaining dependency findings and peer conflicts before shipping or hosting those tools. They are excluded from the consumer kit. |
| Mobile and live providers | Qualify the chosen simulator/device/provider profiles separately; deterministic browser passes do not substitute. |
| Registry/public release | Verify namespace ownership, publication rights, release revision, notices and checksums. No npm package publication is claimed. |

MIT provenance and separate dependency licenses are retained. Declared platform
profiles and exact evidence are in
[support-profiles.json](docs/development/support-profiles.json).
