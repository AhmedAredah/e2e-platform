# Python review implementation record

Candidate: **0.2.0-rc.8** / Python wheel **0.2.0rc8**. Reviewed baseline:
`3b771b93ebe8fc7070f6000ee8acdef655a6abd7`. This record separates implemented
corrections from broader framework and platform qualification.

## Findings and disposition

| Review finding | Implementation | Qualification or remaining boundary |
| --- | --- | --- |
| F01 Failed AT-SPI pruning publishes usable references | Publish `_last_seen` only after all fallible cleanup. Protocol-boundary regression rejects stale mutations and verifies recovery. | Portable provider suite: 86 tests. Live reference runs remain separate. |
| F02 Blank duplicate/unknown HTTP fields disappear | Preserve blank query values, bound field count, reject invalid exact-key input. | Python HTTP regression and installed positive/negative HTTP cases. Shared language fixture also checks these queries. |
| F03 No Python SDK/pytest integration | Typed OO SDK, abstract transport, composable locators, assertions, application/process/HTTP objects, pytest fixtures and registration. C++ host extracted into a shared module. | SDK contract tests and real runner tests exercise failures, teardown, parametrization, skips, strict XPASS, exact numbers, binary I/O, readiness, service crash and async fixtures. |
| F04 No installed Python distribution | Wheel and source archive, MIT metadata, `py.typed`, checksummed manifest, version synchronization and fresh external consumer verification. | Clean wheel imports outside the checkout; separate npm installation. No PyPI/npm publication or namespace ownership claim. |
| F05 No Python Qt qualification | Real PySide/PyQt Widgets and Quick reference applications; Python-authored GTK3/WPF/AppKit acceptance added. | All three OS Python Qt and desktop reference consumer profiles passed at the checkpoint below. Tkinter, wxPython, Kivy, packaged executables and custom canvases are not certified by these fixtures. |
| F06 API and driver parity limits | Python exposes shared semantic controls, app lifecycle, optional terminal/window operations and same assertions. | OS screenshots/global keyboard/IME/drag/drop/video/visual diff and hybrid DOM switching remain absent. Browser/mobile engines are retained, but complete engine-specific Python bindings are not implemented. |
| F07 Narrow Python runtime matrix | CI configures Python 3.11–3.15 on Linux, Windows and macOS, plus the minimum supported pytest. | All 15 OS/minor-version installed consumers and the minimum-pytest check passed. Exact installed runtime versions are recorded below and in support-profiles.json. |
| F08 No module launch/onboarding/verifier | `PythonLaunchProfile` accepts script or module; Python `init` generates runnable config/tests without overwriting files; local `run` resolves installed Node entry; clean consumer verifier. | Node remains a runtime dependency. No automatic package download or interpreter guessing. |
| F09 Sparse lifecycle tests | Owned service readiness waits for complete UTF-8 lines, rejects early death/truncation, and requires owned shutdown. Binary streams, HTTP JSON/status, async cancellation and fixture teardown failures are tested. | Real Flask/Django/FastAPI fixtures cover JSON, cookie login/logout, fresh process state and planted wrong results. Database resets, WebSockets, gRPC and production authentication schemes still need application contracts. |
| F10 No Python lint/type/wheel CI | Ruff, mypy, pytest contract suite, installed-wheel/Node consumers and negative oracles gate the Python workflow. Release packaging depends on the workflow. | Lint/type tools run on Python 3.12; runtime acceptance spans the declared matrix. |
| F11 Optional workspace dependency findings | Keep optional docs/mobile dependency scope separate from the installable kit and record the fresh kit audit. | The prior review's 10 optional findings are not claimed fixed by Python SDK work. Do not use unsafe version overrides to hide them. |
| F12 Documentation/distribution/evidence drift | Python guide, SDK/package READMEs, docs navigation, consumer guidance, support metadata, Changesets and this issue map updated together. | Stable release still needs successful exact-commit platform checks and any additional desired profiles. |

## Design and organization

- `packages/authoring`: bounded host, protocol/JSON validation, operation dispatch,
  owned resources and case registration. Core does not depend on engine internals.
- `packages/python`: Python discovery/registration only.
- `sdks/python`: `Transport` abstract base, `StdioTransport`, `Screen`/`Locator`,
  `OwnedProcess`/`ApplicationService`, typed result objects and pytest integration.
- `examples/with-python`: independently checked applications and tests. Deliberate
  wrong-output variants are intentional fixtures, not defects to remove.
- `scripts/python`: packaging, version synchronization and installed consumer proof.
- Generated wheels, npm tarballs, caches, reports and tool dependencies stay in
  ignored output directories, outside committed source.

Both language clients use one scheduler and report model. Shared operation failures
are latched; malformed/partial frames, missing completion, ignored failures and
cleanup errors cannot become passing tests. Async cancellation invalidates the
channel and leaves final ownership with the parent deadline and cleanup. A new
mutation is never replayed after an uncertain result.

## Evidence rules

Local Python protocol/type/lint and real CLI/HTTP checks are implementation evidence.
Real platform workflows must prove GUI controls against the actual sidecar and
toolkit. Positive output alone is insufficient: a deliberately incorrect app must
fail for the named independent output oracle, without retries or cleanup failures.
Installed consumers use packed npm artifacts and a newly built Python wheel in a
temporary project, not workspace imports. `.e2e/python/<profile>/qualification.json` records
versions and wheel hashes only after every required scenario finishes.

No universal “any Python desktop application” or stable-release claim is made.
Such a claim would require capabilities and provider interfaces that some toolkits
do not expose. Extend and qualify the actual backend/control contract for each
additional supported profile.

## Local validation before hosted qualification

- `pnpm check:local`: lint, dead-code checks, all package builds/typechecks, error
  documentation and 51 documentation pages passed.
- Application-boundary suites: process 79 passed (5 platform-specific skips),
  checks 19, HTTP 20, native 119, terminal 50, shared authoring 5, C++ 17 and Python
  12 passed. The C++ host extraction preserves the existing regression suite.
- Python SDK: 24 contract tests, Ruff and mypy passed on Python 3.12.14.
- AT-SPI: 86 portable tests; calculator HTTP input regression passed.
- Maintenance/install tooling: all 72 script tests passed.
- Fresh nine-package kit: checksums, install/reinstall, metadata, direct imports,
  generated CLI test, planted incorrect output and consumer TypeScript passed.
  The installed tool dependency audit reported zero findings.
- Fresh wheel consumer: Python scaffold/init/run, binary CLI and HTTP positives
  passed; both planted output defects were rejected for the expected oracle,
  with complete cleanup. The consumer resolved pytest 9.2.0.
- Real framework HTTP consumers: Flask 3.1.3, Django 5.2.18, FastAPI 0.162.0 and
  Uvicorn 0.54.0; three positive flows and three deliberate incorrect-result
  cases passed qualification, including explicit cookie lifecycle and process reset.

These local results do not substitute for Windows/macOS, Qt accessibility or
other Python minor-version acceptance. Hosted results are recorded separately.


## First hosted findings and follow-up

The first Python matrix exposed a CRLF-sensitive version check on Windows and
an incompatible build 1.3.0 argument formatter on Python 3.15. The checker now
accepts CRLF, has a failure-manifest regression, and the frontend is pinned to
build 1.6.1. Python packaging now invalidates an earlier manifest before version
validation and publishes the replacement atomically. Linux Qt qualification adds
the explicit XCB runtime prerequisites and a bounded fixture startup probe, so
missing host libraries are visible before redacted sidecar diagnostics. Framework
startup has a bounded probe and a 20-second readiness budget. Readiness failures
now retain their controlled cause in the shared report. These corrections require
new hosted results; failed earlier jobs are not counted as passes.

The next hosted run confirmed Windows installed consumers, Qt UIA and Python
3.15 on Windows/Linux. Linux Qt still failed to load the XCB plugin even after
the cursor dependencies were installed. Its prerequisites now include OpenGL,
Xlib/XCB and the remaining plugin libraries explicitly, with `ldd` validation
before startup so unresolved library names remain visible.

The complete X11 runtime made Widgets positive and planted-negative acceptance
pass. Quick then reached `locator.fill` and correctly refused an unavailable
editable interface. Local QAccessible probes confirmed that Qt 6.8 TextField
has no editable interface and reports editable false, whereas Qt 6.12 exposes
both. The Python reference bindings now pin Qt 6.12.0 and retain the identical
control workflow and independent output oracle. Qt 6.8 Quick/AT-SPI is not
included in the support claim. C++ cooperative Qt profiles retain their separate
previously tested kits.

Live PySide6 failure collection also exposed a readonly deadline edge: closing
the socket for a final timed-out poll made the orderly sidecar exit appear as
a secondary application failure. The transport now retains that request ID
until the late reply is drained, while returning the original timeout on time.
Three real TCP regressions cover reply isolation, queued deadlines/owned close
and malformed late responses. Mutation uncertainty and cancellation still close.

The macOS WSGI fixture's startup probe took about 35 seconds before readiness.
The reference server now binds its literal loopback address without the standard
HTTP server's reverse-DNS lookup. A real bind regression makes any reverse-DNS
call fail, and checks the server environment. This does not change the runner's
readiness deadlines or substitute an in-process HTTP mock for real framework
requests.

## Hosted qualification checkpoint

Source: `6494472ac1382a968ca1a4b92241682a323b3b81`, recorded 2026-10-28.
The [Python workflow](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513854)
passed all 25 required jobs on the first attempt. The previously pending macOS
runtime, framework HTTP and Python Qt profiles are now qualified at this source.

| Profile | Verified scope |
| --- | --- |
| Linux installed SDK | Python 3.11.17, 3.12.15, 3.13.17, 3.14.9 and 3.15.1; pytest 9.2.0; fresh wheel/nine-package consumers and CLI/HTTP positive/negative scenarios |
| Windows installed SDK | Python 3.11.9, 3.12.10, 3.13.17, 3.14.9 and 3.15.1; pytest 9.2.0; equivalent installed consumers |
| macOS installed SDK | Python 3.11.9, 3.12.10, 3.13.15, 3.14.7 and 3.15.2 on arm64; pytest 9.2.0; equivalent installed consumers |
| Minimum pytest | pytest 8.4.2 on Linux/Python 3.11, SDK contract tests |
| Python Qt | PySide6 6.12.0 and PyQt6 6.12.0 with Qt 6.12.0, Widgets and Quick, Linux AT-SPI/X11, Windows UIA and macOS AX; actual fill/check/uncheck/click/value assertions |
| Framework HTTP | Flask 3.1.3, Django 5.2.18, FastAPI 0.162.0 and Uvicorn 0.54.0 on Windows/Linux/macOS; real network requests, explicit cookie lifecycle and fresh-process reset |
| OS desktop consumers | All five [desktop-contracts jobs](https://github.com/AhmedAredah/e2e-platform/actions/runs/40724513683) passed; installed TypeScript, C++ and Python tests against GTK3/AT-SPI, WPF/UIA and AppKit/AX, including macOS arm64 |

The 24 completed Python artifacts were downloaded. Their archive bytes match
GitHub's SHA-256 digests, their qualification records identify this exact source,
and each contained wheel matches its recorded checksum. Three desktop consumer,
nine native and three language archives were verified the same way: 39 archives
and 315 reports in total. All positive cases passed and
every deliberate wrong result failed its named assertion with complete cleanup,
no secondary errors and no retries. Artifact identities, exact runtime versions
and hashes are recorded in [support-profiles.json](support-profiles.json).

The full repository checkpoint has all 47 required jobs passed across seven
workflows, with zero failures or pending jobs. The optional live-model benchmark
was not invoked. This checkpoint does not turn an earlier intermittent crash
into a resolved defect; the remaining issue below is recorded separately.

## Remaining Cocoa stability issue

At source `0e9ae2d50fb66a9dd53d18473c42766c43dfb905`, the earlier
[Cocoa job](https://github.com/AhmedAredah/e2e-platform/actions/runs/40721115865/job/122931954525)
correctly rejected the planted Quick calculation but then reported `SIGABRT`
during cleanup. The crash changed the runner exit from the expected assertion
failure (1) to infrastructure failure (3). It must not be ignored or accepted
as a valid negative test. Its archive digest is
`762b152d6a8998bff3ce81d97fb14d74986e63ce4f992b233c6e140884765bdf`.

The existing diagnostic launched `e2e_qt_quick_controls_tests`, which exited
successfully; it did not capture the original `e2e_qt_quick_demo` crash stack.
A focused Linux Qt 6.4.2 AddressSanitizer test of 20 connected bridge destruction
cycles did not reproduce a suspected socket teardown issue. No root cause or
runtime fix is claimed. The later full Cocoa job passed, including eight
installed static/shared positive/negative cases, but stability remains open.

Diagnostics now retain recent macOS `.ips`/`.crash` reports only for the known
Qt reference executables before running the separate LLDB probe. A dedicated
collector enforces file-name, age, regular-file, count and byte limits. Three
portable regressions pass; the maintenance suite now passes 75 tests. This
diagnostic improvement preserves the original failing verdict. A reproduced
original crash with its actual stack and a verified correction remain necessary
before claiming the Cocoa stability issue is resolved. This issue concerns the
C++ cooperative Qt helper; it is not a failure of the passed Python Qt/AX profile.

## Remaining release boundaries

- Resolve the intermittent C++ Qt/Cocoa cleanup crash before declaring the
  broader desktop product stable. The Python platform qualification is complete
  for its named reference profiles; it does not certify every GUI toolkit.
- This is an installable source-built release candidate. Package registries and
  a stable release have not been published; follow PYTHON.md for installation.
- Toolkit/control coverage remains explicit. Tkinter, wxPython, Kivy, packaged
  applications, custom canvases and hybrid webviews require their own acceptance
  evidence and any missing adapters. No universal desktop compatibility claim.
- Full engine-specific browser/mobile Python APIs, OS screenshots/global keyboard,
  IME, drag/drop, visual comparison and video remain outside this bounded SDK.
  Existing browser/mobile engines and C++ support remain in the repository.
- Ten existing optional workspace dependency advisories remain documented in
  dependency-audit-current.json. The fresh installed nine-package consumer audit
  reports zero findings; the optional advisories are not represented as resolved.
