# e2e-platform 0.2.0-rc.2

This is a reviewed **prerelease**, not a fully qualified stable release. The ten
public JavaScript packages use `0.2.0-rc.2` and `@e2e-platform/*`; the executable
and repository folder are `e2e-platform`. Tests are written in TypeScript or
JavaScript. The application under test can use Python, C#/.NET, C++, Rust or
another language; GUI support depends on accessible controls and the driver.

## Publication state

[AhmedAredah/e2e-platform](https://github.com/AhmedAredah/e2e-platform) was created
as a real GitHub fork of TesterArmy e2e. Issues and private vulnerability reporting
are enabled. The reviewed candidate source is maintained on
[`mit-main`](https://github.com/AhmedAredah/e2e-platform/tree/mit-main).
The separately retained `main` branch remains
the original upstream Apache-licensed snapshot. **It is not this candidate.**
No GitHub release, npm publication, remote CI pass or registry namespace ownership
is claimed. Clone `mit-main` or use the reviewed full-repository archive.
[Publishing instructions](docs/development/PUBLISHING.md) preserve upstream `main`
and update `mit-main` without a force push.

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
cooperative Qt bridge is C++. These are platform implementations, not four
independent full test-runner SDKs.

## Recorded verification

Checks below ran against this candidate on the available Linux x64 environment.
Detailed logs, command records, intentional failures and hashes accompany the
validation bundle. Earlier unsuccessful runs are retained and clearly superseded
by qualified reruns. Historical rc.0/rc.1 results do not qualify this candidate.

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

The validation summary links the exact consumer-kit and browser reports. This source ZIP contains tracked source and Git history plus a checksummed
six-package JavaScript install kit. A normal GitHub source ZIP contains neither
Git history nor the generated kit. SDKs, Qt, browser binaries, OS libraries and
package-manager caches remain external prerequisites.

## Dependency findings

Compatible dependency updates reduced the full workspace audit from **57 to 11**
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

The new OS drivers remain experimental. This host denies AF_UNIX sockets needed
for D-Bus/AT-SPI. Windows UIA and macOS AX need native interactive desktops and
permissions; portable tests and cross-compilation are not live qualification.
Each additional framework and toolkit version requires its own real-control test.

Full browser CDP attach/recovery, mobile simulators/hardware and live model-provider
qualification remain open. The corresponding workflows are source, not successful
remote runs. Native-language full runner SDKs, generic custom-painted controls,
global OS input, OS-driver screenshots and hybrid DOM/native switching are absent.

Before a stable release, complete the real platform gates, assess or resolve the
remaining dependency findings for each shipped distribution, and verify publication
and install paths on the hosted repository. Declared platform profiles are in
[support-profiles.json](docs/development/support-profiles.json).
