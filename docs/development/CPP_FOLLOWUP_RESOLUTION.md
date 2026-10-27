# C++ and desktop follow-up resolution

This record addresses the seven findings from the 2026-10-27 review of
`f59dbf285536ae9cf14eff43b3900c1b4889718e`. It describes the subsequent source
changes, not a stable release or universal C++ framework certification.

## Corrections

| Finding | Change | Regression or acceptance evidence |
| --- | --- | --- |
| F01: lossy C++ HTTP JSON | A dedicated JSON layer compares each original number with its parsed decimal round trip. Default parsing preserves signed/unsigned 64-bit integers and rejects silent decimal rounding and underflow. Explicit `JsonNumberPolicy::binary64` permits those conversions. Errors omit response content. | Compiled SDK JSON tests cover integer boundaries, rounding, underflow, duplicate keys, depth and invalid policies. Installed CMake consumers exercise real HTTP precision endpoints through compiled test bodies and the public runner. |
| F02: forgotten password sensitivity | Linux and macOS retain observed secure/password classification by control identity, including reveal/metadata changes. Password purpose survives. Linux defunct identities are pruned; neither registry reassigns IDs. | Linux transition tests use failing getters to prove protected contents are never read. Rust tests cover sticky classification and replacement identities. Real GTK and AppKit reveal fixtures are included in hosted acceptance. |
| F03: incomplete Windows selection readiness | Read-only preparation resolves the requested realized option and checks ownership, uniqueness and enabled state. Dispatch repeats resolution and observes selection after at most one mutation. Collapsed, unrealized options require an explicit popup-opening action. | WPF acceptance covers missing, delayed, disabled and duplicate labels, preflight without selection, explicit combo opening, and observed selection. Installed TypeScript/C++ cases wait for a delayed option and check the application result. |
| F04: false Qt scroll success | Built-in Widgets/Quick scroll handlers require center visibility through clipping ancestors. Unsupported clipping fails before dispatch. Failure to establish visibility after scrolling is an uncertain mutation. Already-visible controls succeed without movement. | Real Qt CTest fixtures cover ordinary clipped children, supported QScrollArea/Flickable containers, already-visible targets and out-of-content postconditions. |
| F05: asymmetric incoming JSON contract | The host validates UTF-8, the 1 MiB frame limit, decoded duplicate keys and nesting before accepting discovery, request or assertion JSON. Lossless assertion-number handling remains separate. | Host tests cover escaped duplicate keys, nested objects, 64/65-level boundaries, extreme depth, malformed syntax and distinct large integers. |
| F06: shared desktop concurrency | A generic `Engine.exclusiveResource` scheduler contract permits one live worker per key across targets. Every native engine declares `local-desktop`. Ownership transfers only after worker exit/cleanup, including failures. | Scheduler tests run multiple targets with a larger worker limit, including failed results, and assert one shared-resource worker. Independent resource keys retain concurrency. |
| F07: affected qs dependency | The pinned workspace override resolves `qs` 6.16.1. The lockfile was regenerated with pnpm 12.3.4 and installed frozen. | Fresh full-workspace and production audits plus clean installed-kit smoke/audit checks distinguish optional tooling from the public distribution. |

The resource key is deliberately run-local. Concurrent runner processes still
need independent desktop sessions or external serialization. This is enforced
serialization, not a new desktop-session allocator. Qt center visibility is
semantic clipping evidence, not a claim of OS-level physical occlusion detection.

## Installed desktop consumer acceptance

`scripts/native/verify-desktop-consumer.mjs` installs the seven-package kit into
a fresh external project, installs the CMake SDK, compiles a C++ consumer using
`find_package`, and runs TypeScript and C++ tests against an explicitly supplied
real OS driver and application. Each language has a positive and an independently
wrong-output run. A negative run must fail the named business-output assertion,
not setup, transport or cleanup. Every report must prove completed cleanup.
The generated qualification records the source commit, OS, architecture, runtime,
kit manifest and outcomes. Previous success is removed before prerequisite checks.

The desktop workflow runs these checks on Linux/GTK3, Windows/WPF and macOS/AppKit.
Linux needs D-Bus/Xvfb and accessibility packages; Windows needs an interactive
UIA session; macOS needs Accessibility permission. The script never substitutes a
fake provider or silently accepts a missing permission.

## Local validation and hosted boundary

Local validation uses pinned pnpm 12.3.4, Node 24.22.1, Linux x86_64, GCC 13.3,
Qt 6.4.2 offscreen/software, .NET SDK 10.0.111 cross-compilation and Rust 1.99.1.
The installed SDK verifier and Qt runner both passed positive tests and rejected
deliberately wrong application results. The Qt helper's four CTest suites passed.
Linux provider tests passed 85 cases, portable UIA checks passed 81, and Rust
portable tests passed 38. Windows driver/WPF builds and AX/AppKit FFI checks pass
locally; those are not Windows/macOS execution evidence.

This workspace cannot open the D-Bus Unix sockets required for live GTK. Real
Windows/macOS desktops are also unavailable locally. Hosted results must be
checked at the exact commit before these new platform paths are marked qualified.
Historical hosted results in `RELEASE_STATUS.md` apply only to their recorded
commits. Installation, source-quality and scheduler results do not substitute for
native platform acceptance.

Final local checks also passed: source lint/dead-code/build/typechecks and 49
documentation pages; 1,550 core unit tests (3 environment skips); 303 application
boundary tests (7 platform skips); and 66 maintenance tests. A first overlapping
build/test invocation invalidated temporary `dist` imports; rerunning the affected
C++ and maintenance suites after the build completed passed. The installed
seven-package kit passed clean installation/reinstallation, public types, plain
Node imports, initializer, deliberate-failure rejection and zero installed
production dependency findings. The production workspace audit still contains
three Expo-only findings (2 high, 1 moderate).

## Hosted acceptance follow-up

The first new hosted run passed Linux installed TypeScript/C++ positive and
negative desktop consumers. It exposed two further integration defects: the WPF
fixture closed its option popup before selection could be observed, and the AX
sidecar announced readiness before the application could answer accessibility
requests. WPF now explicitly opens and closes the popup around the observation. Its dynamic
selection-result label uses its displayed text as the accessible name, while a
stable AutomationId provides the locator; a fixed name must not mask that output.
AX now polls bounded read-only startup observations before announcing readiness;
permission errors remain terminal and mutations are never retried. The Qt planted
negative also exposed an assertion deadline error crossing separate runner module
copies. The existing structural error marker now preserves an observed mismatch
at the deadline; new regressions fail before the correction and pass afterward.
Initial or early backend failures still retain their original classification. Portable
startup tests cover transient failures, empty trees, cancellation and timeout.

## Dependency and release boundaries

The updated full-workspace audit reports 11 findings (8 high, 2 moderate, 1 low)
in optional documentation tooling and the private Expo benchmark. This repository
is not vulnerability-free. The `qs` correction addresses
[GHSA-6pq8-jhm2-2vcw](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw);
the audit does not establish that the affected stringify options were reachable
from the previous public runner. The installed consumer kit has a separate audit.

The architecture keeps the C++ transport, JSON layer, semantic session objects,
runner host, control adapters and OS providers separate. Core scheduling depends
only on the generic resource contract. New fixtures and generated-evidence paths
remain in their existing module directories; generated builds/reports are ignored.
No license baseline or third-party notice is removed.

Remaining scope is explicit: arbitrary custom-painted controls, every C++ toolkit
and version, OS-sidecar screenshots, physical input/IME, native video, visual diffs,
WebView DOM integration and independent desktop-session allocation are not added
by these fixes. Custom controls need application accessibility or an appropriate
adapter plus real acceptance tests. Python/C#/Rust test-authoring SDKs remain
future work. Stable release publication still requires the exact final hosted
qualification, distribution checks, namespace rights and release approval.
