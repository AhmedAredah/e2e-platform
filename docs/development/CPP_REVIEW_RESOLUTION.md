# C++ review resolution record

Status: **all 27 reviewed findings addressed; bounded prerelease qualification**.

This records the work against the 27 findings in the C++ review of base commit
`3b1fe90a12d0e4c2ec3ce0fa75ddf0a0ed35aa94`. These changes are prerelease work,
not a package publication or stable release. Existing evidence for that base commit is historical;
it does not qualify these modified sources. Versions remain `0.2.0-rc.7` with an
unreleased Changeset. C++ authoring protocol 2 requires rebuilding test binaries
with the matching host. Native desktop protocol 1 is unchanged.

## Release decision

The numerical false passes, incomplete-case acceptance, privacy disclosure,
cleanup ownership defect and reviewed qualification defects have code fixes and
focused regression coverage. Local Linux Qt acceptance covers both offscreen and
X11/Xvfb, including runner-driven Widgets/Quick positive and planted-defect tests.
Fresh installed static/shared Qt consumers exercise both toolkit families.

R07 is resolved for the supported test profiles. The LLDB trace identified Qt's
native macOS style drawing an NSView through the offscreen backend. Headless
macOS tests explicitly use the Basic style; a separate Cocoa job tests the native
macOS style. Both pass without removing Quick coverage. The native Cocoa run also
exposed an asynchronous close assertion; the protocol test now waits for the
accepted failure to be latched and checks it through a read-only snapshot.

The [complete native matrix](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293679)
passed all nine jobs at `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`: three command/
package profiles and six Qt display profiles. This includes both macOS modifier
configurations, installed static/shared Widgets and Quick consumers, export and
masked-capture proofs, Windows Unicode and environment tests, and clean installs.
The package workflow depends on that full matrix and the desktop acceptance jobs.

Windows UIA/WPF and Linux GTK3 live acceptance passed at that source checkpoint.
The [macOS AX/AppKit acceptance suite](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293705/job/122176012450)
passed at `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`, including all eight advertised
operations, selection, real scrolling, wrong-output rejection and owned cleanup.
The scroll fixture uses an application-owned NSAccessibilityElement backed by a
real view; an advertised action on an ordinary NSView was not sufficient. The
driver continues to reject unsupported actions rather than returning success.
Every additional
framework, control or display profile still needs its own qualification; there is
no claim of support for every C++ framework or custom canvas.

## Findings and dispositions

| ID | Change | Verification / remaining requirement |
|---|---|---|
| R01 | Encode equality operands as JSON texts; compare exact decimal lexemes in the host, including nested signed/unsigned 64-bit values. | Host negative regressions and compiled installed SDK contracts distinguish adjacent `uint64_t` values. |
| R02 | Reject nonfinite, binary/discarded and excessive-depth JSON before serialization; latch local failure even if caught. | SDK protocol tests cover nested NaN/infinities and HTTP request serialization; compiled caught-NaN case fails. |
| R03 | Require acknowledged case start and completion around normal return from the registered body. | A compiled `std::exit(0)` case fails; a normally completed empty body may pass. |
| R04 | Suppress secure Quick window titles/children and mask the full root capture. | Native Qt test checks tree, window metadata and every pixel in the mask. |
| R05 | Derive replacement Select All from Qt standard key bindings; preserve explicit physical modifier parsing. | Linux and both macOS modifier configurations passed in the complete native matrix. |
| R06 | Request and confirm widget window activation with a bounded wait before focus/typing. | Detailed Qt tests and the full Widgets/Quick runner workflow pass locally under X11/Xvfb, Qt 6.4.2. This does not certify all Qt/platform versions. |
| R07 | Diagnose native-style/offscreen crash; test Basic/offscreen and native macOS/Cocoa separately; wait for asynchronous accepted close failure. | Resolved: both macOS jobs and all nine native matrix jobs passed; the failure-only LLDB capture remains available. |
| R08 | Retain child/driver ownership and isolated profile until stop/close succeeds. | Real-child regression verifies profile retention, blocked attempt reuse and successful cleanup retry. |
| R09 | Validate HTTP JSON number lexemes before JavaScript conversion; reject unsafe numbers by default. | HTTP tests reject rounded large integers/decimals; explicit binary64 policy is available. |
| R10 | Decode C++ HTTP response bytes with fatal UTF-8 validation. | Runner integration serves malformed bytes and verifies failure before an assertion can accept replacement characters. |
| R11 | Add extensible tracked tab classes with non-overridable lifetime bookkeeping and separate extension hooks. Plain tabs fail closed for mutation. | Remove/reinsert ABA regression, untracked-control refusal and installed public-header consumer. |
| R12 | Refuse unsupported header/action scrolling instead of acknowledging a no-op. | Offscreen header regression confirms explicit capability error and unchanged scroll position. |
| R13 | Resolve the requested combobox option during read-only preflight. | Widgets and Quick delayed-option tests prove preflight changes no selection before one perform operation. |
| R14 | Recompute AX ancestor geometry, clipping, hidden and minimized state at action time. | Passed native AppKit acceptance: a moved control becomes non-actionable without a fresh snapshot; readonly preflight never mutates. |
| R15 | Synchronize the AX live verifier with eight advertised actions. | All eight operations passed on macOS 15, including three selection forms and actual scroll-viewport movement; the planted output defect was rejected. |
| R16 | Require an explicit oracle marker in the intended failure, plus exact title, assertion category, no retries and complete cleanup. | Validators reject unrelated earlier assertions; compiled and Qt negative workflows use marked calculation assertions. Python/C#/Rust negative reports also require their independent output-oracle label. |
| R17 | Configure every detailed Qt CTest and child with the selected QPA backend. | Generated CTest configuration and successful local xcb runs confirm that X11 jobs no longer silently run offscreen. |
| R18 | Reuse the full native matrix in the package workflow. | All nine jobs passed in run 40500293679; any eventual release invocation must pass the same dependency gate. |
| R19 | Compare canonical working-directory paths on platforms with path aliases. | macOS command/package job passed, including canonical `/var` path aliases. |
| R20 | Install the same checked kit into a second clean conventional path rather than renaming a loaded Windows project tree. | Clean install/reinstall and both path profiles passed on Windows, macOS and Linux. |
| R21 | Distinguish polling exhaustion from an in-flight transport deadline without depending on an 80 ms scheduling race. | Real-transport test accepts the two valid deadline outcomes and proves no perform; controlled-clock test checks polling exhaustion. |
| R22 | Keep terminal location metadata constant; title remains in the bounded semantic name. | Regression checks the whole observation, including location, for partial-secret leakage. |
| R23 | Apply Windows PTY environment overrides/removals case-insensitively. | Portable aliases/deletion/replacement and Windows native-package tests passed; Unix case sensitivity is preserved. |
| R24 | Validate schema return shape and protect all result/getter processing inside the sanitized error boundary. | Invalid empty results and throwing `issues`/`value` getters produce content-free schema failures. |
| R25 | Share a locale-independent number parser between the CLI and HTTP example; reject nonzero values underflowing to zero. | CTest and real HTTP negative-input coverage include `1e-9999`; existing CLI diagnostics are preserved. |
| R26 | Use the same `build/bin` layout for CLI and HTTP targets across standard CMake configurations. | Direct examples and compiled verification passed on Windows, macOS and Linux, including Windows multi-configuration output discovery. |
| R27 | Remove prior success aggregates before install-smoke and Qt-export prerequisites execute, including before importing built modules. | Isolated script regressions cover invalid arguments and missing build output. Failed reruns cannot retain previous success summaries; subrun evidence remains separate from a final success record. |

## Hosted regression follow-up

A repeat X11 installed-consumer run exposed an early native request timer that
could replace a known mismatch with a premature timeout. The transport now
rechecks its deadline; controlled read/mutation regressions fail before the fix
and pass afterward, with one dispatch and no remaining timer. A separate real
reporting test now establishes helper readiness and uses a realistic one-second
assertion budget, while requiring both ASSERTION_FAILED and the observed value.
Controlled-clock tests still cover exact deadline behavior.

## Additional review advisories

- CSV numeric columns now expose an explicit binary64 decimal policy. Exactness
  remains the default. Tolerance verdicts compare exact represented binary64
  operands and budgets, avoiding rounded-boundary false passes; displayed
  differences remain floating-point diagnostics.
- `E2E_TEST_MAIN()` provides Windows wide-argument dispatch with strict UTF-8
  conversion. Installed CMake usage supplies MSVC UTF-8 and MinGW Unicode
  entrypoint settings. Use the wide overload for a custom Windows entrypoint.
- Installed Qt packages enforce exact Qt version, compiler family and pointer
  width. A matching architecture/ABI kit remains the consumer's requirement;
  these checks cannot validate every third-party plugin or compiler setting.
- The calculator CTest output pattern requires the complete numeric token.
- `E2E_TEST` sends a bounded source basename and registration line. C++ assertion
  diagnostics identify the case-definition location; assertion-level C++ stack
  traces are not fabricated or claimed.
- Qt request IDs require positive safe integers. String, fractional, zero,
  negative and out-of-range IDs have native regressions.
- Installed static and shared acceptance includes Quick alongside Widgets.
- Windows live acceptance now covers mutation-free preflight and an offscreen
  control scrolled into view. macOS live acceptance checks preflight without
  mutation and geometry changed since the last snapshot. AX selection/scrolling
  remain conditional on the application's exposed AX attributes/actions; qualification
  is limited to the recorded reference controls.

## Organization and compatibility

Contracts remain in the shared runner and abstract process/driver/transport
classes. Toolkit details remain under `native/qt`; tracked tab public controls
live in a dedicated installed header and implementation. Numeric parsing and
exact comparison are separate modules. The CLI/HTTP examples share a parser;
verification and debugger tooling remain under `scripts/native`. Generated
reports, captures, build products, dependency directories and credentials are
excluded from source distribution.

The original review is preserved separately. The Changeset and package/toolkit
READMEs explain migration. MIT provenance and dependency notices are retained;
no later Apache-only upstream implementation was imported. This work does not
change the repository name, add another GUI backend, or claim application-language
support implies framework certification.

## Validation record

Local checks passed for lint, dead code, build/typechecking, documented error
codes, documentation links, the installed seven-package consumer kit, C++ SDK
contracts, Linux Qt Widgets/Quick workflows, and Python/C#/Rust CLI/HTTP examples.
Installed static/shared Widgets/Quick acceptance passed locally under X11 and
on every hosted Qt display profile listed above. SDK-authored Qt tests and
detailed Qt CTests passed in the same platform matrix.

The local full-Chrome CDP run was blocked by this runtime's Unix-socket `EPERM`
restriction. That limitation is superseded for release qualification by the
[hosted spec run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40500293662)
at `4f1f6a0f889f5979d39b8eaa912c35307bd8c596`: lint/dead code/typechecks/testbed and
full unit/integration suites passed on Node 22.22.3 and 24.22.1, including CDP.
All five required workflows passed at that exact code/test checkpoint. The
subsequent evidence-documentation update changes no executable or test source.
Cancelled concurrency predecessors are not reported as passing runs.

See RELEASE_STATUS.md, support-profiles.json and the accompanying validation report
for exact source checkpoints, native acceptance scope, artifact checksums and the
remaining distribution/optional-tooling boundaries. Source publication is distinct
from registry publication or a stable release tag.
