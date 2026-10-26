# MIT fork release candidate

The current local candidate is **0.2.0-rc.0** across all ten public JavaScript
packages. The independently versioned Qt C++ helper remains 0.1.0; its public
C++ ABI did not change. This is a tested prerelease, not a stable or published
registry release. Namespace ownership, a private security contact, signed
artifacts and hosted publication remain maintainer release requirements.

The MIT base is `e9c2914c6d8f8d664d820b13a1fa454e9247e94b`. This hardening work
extends the MIT checkout without importing later Apache-only upstream source.
[LICENSING.md](docs/development/LICENSING.md) records the original provenance
review; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) records separate dependency
and toolkit obligations. Earlier candidate validation is not substituted for the
checks below.

## Recorded validation — October 24–25, 2026 UTC

Local platform: Linux x64, Node 24.22.1, pnpm 12.3.4, GCC 13.3, CMake 3.28.3,
Qt 6.4.2 with the offscreen/software backend. Language examples used Python
3.12.14, .NET SDK 10.0.402, rustc 1.99.1 and Cargo 1.99.1. Browser tests used
Playwright 1.63.0 and its exact Chromium 1243 / Chrome 153.0.8010.12 version.
Official browser/toolchain download provenance is retained in the evidence.

| Check | Result |
| --- | --- |
| Repository quality | `check:local` passed: lint, dead-code gate, all ten package builds, workspace types, 76 error-code entries, seven embedded examples and 44 documentation pages. Final script/test edits also passed lint and their relevant checks. Nonfatal static-analysis warnings about public class members and dependency overrides are retained in the log. |
| Core unit and integration suite | All 163 files passed: 1,872 tests passed, zero failed, three existing environment skips (two privileged permission guards and one case-insensitive-filesystem branch). No core files were excluded. |
| C++ boundary packages | Process 36, checks 17, HTTP protocol 16, native 68 and terminal 38 tests passed. Includes real subprocesses/PTYs, native factory lifecycle and protocol schema conformance. |
| Playwright qualified subset | 241 tests in 26 files passed, with no skips in that selection, including real final-dialog and final-route callback regressions. Two CDP files remain blocked as described below. |
| Retained packages | Agent-device 92 passed with five unavailable simulator checks skipped; GitHub reporter 19 and OAuth 62 passed. Provider behavior used mocks, not live accounts. |
| Maintenance and verifier tests | 45 passed, including real clean-build validation, language coverage/cleanup gates and report-owned screenshot verification. |
| Real C++/Qt workflows | CLI three, Widgets three and Quick one positive tests passed. Both planted CLI/Qt defects failed with the required `ASSERTION_FAILED` and complete cleanup. |
| Compiled Qt checks | CLI CTest 3/3 and Qt CTest 3/3 passed, including 67 Qt test rows. Static and hidden-visibility shared installed CMake consumers both built and ran. |
| Qt security and export evidence | Sensitive-control/overlap regressions passed; six installed-helper probes exited cleanly. Export oracle accepted 82.5 EUR, rejected planted 83.5 EUR and validated the current report's masked screenshot by ownership, confinement, size and SHA-256. |
| Real Python/C#/Rust workflows | Nine positive scenarios passed; all six planted CLI/HTTP wrong results failed specifically as assertion failures. Exact per-language scenario coverage, one attempt and complete cleanup were required. |
| Exact packaged consumer | Six rc tarballs passed checksums, installation and clean npm reinstall from paths containing spaces/ampersands, CLI/import checks, positive and planted-failure tests, native schema presence, and strict TypeScript use of public APIs and subclass extension points. |
| Installed dependency audit | Zero reported vulnerabilities across the 162 dependencies of the installed test tool, including its development dependencies. The audited lockfile and dated output are retained. |

Detailed evidence is delivered separately in `e2e-cpp-mit-validation.zip`.
Overlapping focused tests are not added to the suite counts above. The evidence
preserves initial failures, their fixes and the final successful reruns. Tests
ran on the working source before its final commit; the archive verification and
source/build manifests connect that source and the exact tested tarballs to the
delivered commit. Reproduce checks using [verification/README.md](verification/README.md).

## Review findings addressed

| Review ID | Implemented correction |
| --- | --- |
| R01 | Keep worker control messages intact and validate them; sanitize public records by field, preserve protocol grammar and stable opaque joins, and keep output ownership across worker boundaries. |
| R02 | Write complete sanitized MCP protocol messages independently of buffered console output. |
| R03 | Require acknowledged worker disposal within the configured cleanup budget; forced or early exits fail the run. |
| R04 | Retain terminal overflow/transport failures through settlement, restart and close. |
| R05 | Quarantine failed cleanup, prevent unsafe retry/reuse and withhold setup snapshots/dependents after lifecycle failure. |
| R06 | Represent cleanup and shared-session failures as JUnit error cases. |
| R07 | Treat stale locator observations as indeterminate, never evidence that a visible control is hidden. |
| R08 | Redact before clipping; omit oversized native fields whole and digest full identities for generated artifact directories. |
| R09 | Track sensitive Qt controls in helper-owned object-lifetime state, independent of writable properties. |
| R10 | Reject Qt Quick taps on covered targets or through unrelated mouse grabs. |
| R11 | Give one-shot visibility reads the normal operation budget. |
| R12 | Preserve exact whitespace in raw input values and attributes; keep rendered-text/class-list normalization separate. |
| R13 | Compare relative numeric error without subnormal multiplication underflow/rounding errors. |
| R14 | Hash unambiguous target/session tuples for storage names. |
| R15 | Clean all build outputs and verify source/config/output inventories plus every public entry before packing. |
| R16 | Bound OAuth requests/refreshes and preserve independent cancellation for shared callers. |
| R17 | Bound OAuth diagnostics and remove submitted credential values and control characters. |
| R18 | Correct origin-policy, support ownership, telemetry and outbound-connection claims. |
| R19 | Make the manual kit workflow depend on core/browser, Qt, three-OS installation and language qualification, then smoke-test the exact uploaded kit. No publishing was enabled. |
| R20 | Correct executable hints/help status, links, folder guidance and workflow descriptions. |

Additional final verification fixed polling past a deadline, settled started
Playwright callbacks before verdicts, omitted confidential artifact references
instead of creating broken links, and made the Qt export oracle follow sealed
current-report evidence instead of scanning unrelated retained files. Some old
screenshot copies were observed during qualification; their exact writer was not
established. The final oracle reset its owned output and verified only current
report artifacts.

## Remaining release gates and support boundaries

- **Full CDP qualification is blocked here.** The complete Playwright attempt
  had 15 failures and three setup skips across `cdp-attach` and `cdp-recovery`.
  Full Chrome aborts because the environment denies `AF_UNIX` socket creation;
  an independent socket probe reproduced the denial. The tests and Chrome
  configuration were not weakened. Run both files successfully in an environment
  that permits Chrome's required sockets before claiming the full suite passed.
- **Windows/macOS, mobile devices/simulators and live providers are unqualified.**
  Their CI workflows are configured but have not been run in this session.
  Linux offscreen Qt results do not establish physical input, Wayland/compositor,
  GPU, accessibility, native-dialog or arbitrary custom-control behavior.
- **Language scope is CLI/local HTTP with TypeScript tests.** Python/C#/Rust
  test-authoring SDKs and PySide/PyQt, WPF/WinForms/WinUI, Avalonia/MAUI,
  Slint/egui/iced/Tauri GUI adapters are future work. The owned-sidecar factory
  and versioned native schemas are extension points, not those implementations.
  See [LANGUAGES.md](LANGUAGES.md) and [CPP_SUPPORT.md](CPP_SUPPORT.md).
- **Three private-demo dependency advisories remain.** The full production
  workspace audit reports two high findings (`node-forge`, Zod 3) and one moderate
  finding (`decode-uri-component`) in the retained private Expo showcase. Those
  dependencies are outside the six-package installation kit. No incompatible
  major substitution was forced merely to silence the audit. Retire or upgrade
  that showcase's dependency chain before distributing it as an application.
- The source ZIP contains the full tracked MIT fork and its Git history, plus
  the checksummed local kit. It excludes generated logs/caches, `node_modules`,
  browsers, compiler/Qt/runtime SDKs and terminal prebuilds. Prepare dependencies
  before working offline; see [OFFLINE_README.md](OFFLINE_README.md).

Audits are time-sensitive. Keep the relevant lockfile, date and tested platform
with every distribution; project MIT licensing does not relicense dependencies
or Qt modules.
