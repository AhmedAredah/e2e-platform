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
| F05 No Python Qt qualification | Real PySide/PyQt Widgets and Quick reference applications; Python-authored GTK3/WPF/AppKit acceptance added. | Live three-OS workflow results are required. Tkinter, wxPython, Kivy, packaged executables and custom canvases are not certified by these fixtures. |
| F06 API and driver parity limits | Python exposes shared semantic controls, app lifecycle, optional terminal/window operations and same assertions. | OS screenshots/global keyboard/IME/drag/drop/video/visual diff and hybrid DOM switching remain absent. Browser/mobile engines are retained, but complete engine-specific Python bindings are not implemented. |
| F07 Narrow Python runtime matrix | CI configures Python 3.11–3.15 on Linux, Windows and macOS, plus the minimum supported pytest. | Workflow configuration is not pass evidence. Local implementation checks use Python 3.12.14; exact hosted versions must be recorded. |
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
  checks 19, HTTP 20, native 116, terminal 50, shared authoring 5, C++ 17 and Python
  11 passed. The C++ host extraction preserves the existing regression suite.
- Python SDK: 24 contract tests, Ruff and mypy passed on Python 3.12.14.
- AT-SPI: 86 portable tests; calculator HTTP input regression passed.
- Maintenance/install tooling: all 70 script tests passed.
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
