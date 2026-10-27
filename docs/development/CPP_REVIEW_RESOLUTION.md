# C++ review resolution record

Status: **prerelease hardening; release approval remains blocked**.

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

**R07 remains unresolved:** the prior macOS Qt Quick segmentation fault needs a
native backtrace and a passing rerun of the exact modified source. A failure-only
LLDB diagnostic step now captures that evidence. No speculative workaround or
skipped test substitutes for resolving the crash. The package workflow now depends
on the complete native workflow, including macOS, Windows, Linux offscreen and
Linux X11. A failure in that matrix prevents the install-kit artifact job.

macOS keyboard changes, AX current-geometry behavior and Windows environment,
Unicode dispatch and installation changes also require their native regression
runs. Portable checks and cross-compilation do not provide those results. Windows
UIA and macOS AX interactive qualification remain required for their documented
control subsets. There is no claim that every C++ framework, custom canvas,
embedded surface or operating system is fully supported.

## Findings and dispositions

| ID | Change | Verification / remaining requirement |
|---|---|---|
| R01 | Encode equality operands as JSON texts; compare exact decimal lexemes in the host, including nested signed/unsigned 64-bit values. | Host negative regressions and compiled installed SDK contracts distinguish adjacent `uint64_t` values. |
| R02 | Reject nonfinite, binary/discarded and excessive-depth JSON before serialization; latch local failure even if caught. | SDK protocol tests cover nested NaN/infinities and HTTP request serialization; compiled caught-NaN case fails. |
| R03 | Require acknowledged case start and completion around normal return from the registered body. | A compiled `std::exit(0)` case fails; a normally completed empty body may pass. |
| R04 | Suppress secure Quick window titles/children and mask the full root capture. | Native Qt test checks tree, window metadata and every pixel in the mask. |
| R05 | Derive replacement Select All from Qt standard key bindings; preserve explicit physical modifier parsing. | Linux regression tests pass. Both macOS modifier configurations still require native reruns. |
| R06 | Request and confirm widget window activation with a bounded wait before focus/typing. | Detailed Qt tests and the full Widgets/Quick runner workflow pass locally under X11/Xvfb, Qt 6.4.2. This does not certify all Qt/platform versions. |
| R07 | Preserve the failing macOS Quick gate and capture LLDB diagnostics on failure. | **Unresolved crash; release blocker.** Native evidence is required. |
| R08 | Retain child/driver ownership and isolated profile until stop/close succeeds. | Real-child regression verifies profile retention, blocked attempt reuse and successful cleanup retry. |
| R09 | Validate HTTP JSON number lexemes before JavaScript conversion; reject unsafe numbers by default. | HTTP tests reject rounded large integers/decimals; explicit binary64 policy is available. |
| R10 | Decode C++ HTTP response bytes with fatal UTF-8 validation. | Runner integration serves malformed bytes and verifies failure before an assertion can accept replacement characters. |
| R11 | Add extensible tracked tab classes with non-overridable lifetime bookkeeping and separate extension hooks. Plain tabs fail closed for mutation. | Remove/reinsert ABA regression, untracked-control refusal and installed public-header consumer. |
| R12 | Refuse unsupported header/action scrolling instead of acknowledging a no-op. | Offscreen header regression confirms explicit capability error and unchanged scroll position. |
| R13 | Resolve the requested combobox option during read-only preflight. | Widgets and Quick delayed-option tests prove preflight changes no selection before one perform operation. |
| R14 | Recompute AX ancestor geometry, clipping, hidden and minimized state at action time. | macOS FFI typecheck and portable semantics tests; new native AppKit fixture moves a control without a new snapshot. Native execution pending. |
| R15 | Synchronize the AX live verifier with eight advertised actions. | Script syntax and provider contract checks; live macOS execution pending. |
| R16 | Require an explicit oracle marker in the intended failure, plus exact title, assertion category, no retries and complete cleanup. | Validators reject unrelated earlier assertions; compiled and Qt negative workflows use marked calculation assertions. Python/C#/Rust negative reports also require their independent output-oracle label. |
| R17 | Configure every detailed Qt CTest and child with the selected QPA backend. | Generated CTest configuration and successful local xcb runs confirm that X11 jobs no longer silently run offscreen. |
| R18 | Reuse the full native matrix in the package workflow. | Workflow reviewed locally; require passing hosted results for the eventual release commit. |
| R19 | Compare canonical working-directory paths on platforms with path aliases. | Portable test updated; macOS `/var` alias behavior needs its native job. |
| R20 | Install the same checked kit into a second clean conventional path rather than renaming a loaded Windows project tree. | Installed-consumer smoke covers both path profiles; Windows run pending. |
| R21 | Distinguish polling exhaustion from an in-flight transport deadline without depending on an 80 ms scheduling race. | Real-transport test accepts the two valid deadline outcomes and proves no perform; controlled-clock test checks polling exhaustion. |
| R22 | Keep terminal location metadata constant; title remains in the bounded semantic name. | Regression checks the whole observation, including location, for partial-secret leakage. |
| R23 | Apply Windows PTY environment overrides/removals case-insensitively. | Portable tests cover aliases, deletion and replacement while preserving Unix case sensitivity; Windows PTY run pending. |
| R24 | Validate schema return shape and protect all result/getter processing inside the sanitized error boundary. | Invalid empty results and throwing `issues`/`value` getters produce content-free schema failures. |
| R25 | Share a locale-independent number parser between the CLI and HTTP example; reject nonzero values underflowing to zero. | CTest and real HTTP negative-input coverage include `1e-9999`; existing CLI diagnostics are preserved. |
| R26 | Use the same `build/bin` layout for CLI and HTTP targets across standard CMake configurations. | Direct examples and File API-based compiled verification pass locally; Windows multi-configuration job remains required. |
| R27 | Remove prior success aggregates before install-smoke and Qt-export prerequisites execute, including before importing built modules. | Isolated script regressions cover invalid arguments and missing build output. Failed reruns cannot retain previous success summaries; subrun evidence remains separate from a final success record. |

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
  remain conditional on the application's exposed AX attributes/actions; their
  interactive positive acceptance coverage is still incomplete.

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
The final installed static/shared Qt profiles used offscreen rendering; separate
runner-driven workflows, SDK Qt tests and detailed Qt CTests passed under X11.

The full root test command did **not** pass: 15 full-Chrome CDP tests failed when
this runtime denied Chrome's Unix socket creation (`EPERM`), before CDP readiness.
The other 242 Playwright tests passed. Packages scheduled after that failure were
run separately and passed. The full command must pass on a normal supported host;
these environment-blocked checks are not release qualification or product passes.

See the accompanying validation report for commands, counts, toolchain versions,
working-tree identity and any environment limitations recorded after the final
checks. Required next release steps are native macOS crash diagnosis, native
Windows/macOS reruns, a complete root test run, and review of exact-source
qualification evidence. Source publication does not satisfy these release gates.
