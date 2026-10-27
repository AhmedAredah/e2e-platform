# e2e-platform 0.2.0-rc.7

This is a reviewed **prerelease**, not a fully qualified stable release. The eleven
public JavaScript packages use `0.2.0-rc.7` and `@e2e-platform/*`; the executable
and repository folder are `e2e-platform`. Tests use TypeScript/JavaScript or the
bounded C++ authoring bridge connected to the shared runner. Python, C# and Rust
authoring SDKs are not included. The application under test can use Python, C#/.NET, C++, Rust or
another language; GUI support depends on accessible controls and the driver.

The [C++ review resolution record](docs/development/CPP_REVIEW_RESOLUTION.md)
tracks protocol 2 hardening, local validation and remaining release blockers,
including the macOS Qt Quick crash. Historical passes below do not resolve
those blockers.

This candidate adds Windows process environment isolation fixes (with the documented
SystemRoot bootstrap exception), qualified AT-SPI text-interface dispatch, sanitized
Linux startup diagnostics, portable path comparisons and deterministic negative
verification. The detailed original review evidence below was recorded for rc.2;
unchanged source trees remain traceable through the publication history. Hosted
checks below identify the exact source checkpoints that were tested. Current candidate
results are recorded per source commit in GitHub Actions and the accompanying
validation bundle; the previous checkpoint's passes do not qualify later changes.
The rc.4 changes address supervised native termination, redacted log drainage,
macOS environment assertions and unnecessary Python HTTP hostname resolution.
The rc.5 changes add bounded macOS process-group reaping retries, safe pnpm 12
Windows launcher resolution, native cleanup categories and a synchronized terminal
overflow fixture. The rc.6 candidate adds an explicit macOS terminal setup
command and separates direct Node verification in metacharacter paths from
npm launcher verification in conventional paths. The documented Windows npm
shim limitation remains; use the direct Node command for paths containing `&`.
The current candidate must pass its own hosted checks.

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
This bridge does not claim full TypeScript API parity or native pytest/xUnit/Cargo
authoring support.

Process fixtures add tracked asynchronous operations, safe run diagnostics and
supervised services with explicit readiness. Application state reset remains a
test fixture responsibility. The optional Windows Job Object supervisor is a
separate native component, not a silent upgrade to default taskkill behavior.

Local OS-driver checks against these changes passed **81 Python tests**, **76
portable UIA checks** and **32 Rust tests**. The UIA driver cross-build completed
without warnings/errors, and the AX `check-macos` FFI typecheck passed. These
results do not run Windows UIA or macOS AX on an interactive desktop. New native
Windows/macOS/Linux Qt profiles and the manual `qt-live` workflow are configured;
they remain unqualified until their actual candidate runs and artifacts pass.
Other candidate results must be recorded by exact source revision, separately
from the historical checkpoints below.

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
plus a checksummed six-package JavaScript install kit. The current kit adds the
C++ bridge as its seventh package. A normal GitHub source ZIP contains neither
Git history nor the generated kit. SDKs, Qt, browser binaries, OS libraries and
package-manager caches remain external prerequisites.

## Dependency findings

The dated rc.2 dependency review reduced the full workspace audit from **57 to 11**
findings: 8 high, 2 moderate, 1 low. Every remaining path is in optional Mintlify
preview/online-validation tooling or the private Expo benchmark. The production-only
workspace audit includes private apps and has 3 findings, all Expo: node-forge,
Zod 3 and decode-uri-component. No public package/engine production path appears
in that workspace report; the exact installed consumer kit has its own audit.
See the [dated advisory inventory](docs/development/dependency-audit-rc2.json).

Some findings have no published fix; others require incompatible dependency-line
updates that have not been functionally qualified. Four optional docs/Expo peer
conflicts also remain. Local documentation checks do not run Mintlify. Do not
represent the whole workspace, docs host or Expo demo as vulnerability-free or
fully qualified. They require separate remediation and runtime verification.

## Remaining release gates

The OS drivers remain prerelease implementations. Linux GTK3 reference controls
now have limited live qualification under hosted D-Bus/Xvfb; the earlier local
host's AF_UNIX restriction does not invalidate that separate result. Windows UIA
and macOS AX still need native interactive desktops and permissions for their
live acceptance tests. Portable tests and successful native builds do not qualify
GUI behavior. Each additional framework, toolkit version and display backend
requires its own real-control test.

Mobile simulators/hardware and live model-provider qualification remain open.
The hosted browser/CDP pass and successful desktop-contracts jobs cover only the
profiles and source checkpoints listed above; they do not qualify these other gates.
Generic custom-painted controls, global OS input, OS-driver screenshots, native
video, visual-diff assertions and hybrid DOM/native switching are absent. The
bounded C++ SDK does not remove the remaining authoring gaps for Python, C# and
Rust or imply every TypeScript feature is exposed in C++.

| Gate | Evidence needed before expanding the claim |
| --- | --- |
| Installable candidate | Checksummed seven-package kit, clean consumer install and reinstall, installed C++/Qt CMake consumers, positive runs and planted-defect failures for the exact artifact. |
| Cross-platform Qt | Actual results for Linux offscreen/Xvfb, Windows and macOS Qt kits, followed by interactive QPA profiles. Cover new models, modal/window behavior, stale controls, custom adapters and negative tests. |
| OS accessibility | Rerun Linux GTK reference acceptance after changes; complete interactive UIA/WPF and AX/AppKit acceptance with permissions. Add real C++ toolkit fixtures before advertising GTKmm, wxWidgets, JUCE, FLTK or Win32-family certification. |
| Windows process ownership | Native Job Object tests proving suspended launch, assignment before execution, descendant termination after natural root exit, cancellation and broken supervisor cleanup. Default taskkill limitations remain documented. |
| Language authoring | Qualify the C++ bridge's documented operations and failure paths. Design Python/C#/.NET/Rust authoring bindings separately if tests must be written in those languages. |
| Retained browser/mobile | Run the retained engines at the new source checkpoint; qualify the intended browser/simulator/device profiles and live-provider paths separately. |
| Distribution | Assess dependencies and notices for the exact source/binary bundle, verify namespace/publication rights and record release revision and checksums. |

Before a stable release, complete the real platform gates, assess or resolve the
remaining dependency findings for each shipped distribution, and verify publication
and install paths on the hosted repository. Declared platform profiles are in
[support-profiles.json](docs/development/support-profiles.json).
