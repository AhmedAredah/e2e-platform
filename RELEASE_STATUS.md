# e2e-platform release candidate

The coordinated JavaScript packages are **0.2.0-rc.1**, renamed from the unpublished
`@e2e-cpp/*` identities to `@e2e-platform/*`. The executable is `e2e-platform`.
The repository folder is `e2e-platform`. This is a local prerelease, not a stable
or published package; registry namespace ownership has not been established.

The MIT upstream base remains `e9c2914c6d8f8d664d820b13a1fa454e9247e94b`.
No later Apache-only upstream source was imported. Retained web/mobile source
and optional dependencies keep their own license notices; new OS drivers are MIT.
See [licensing](docs/development/LICENSING.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

## Current implementation

- Shared TypeScript runner, locators, assertions, process/HTTP/terminal boundaries,
  reports and authenticated native transport.
- `desktop()` and extensible `DesktopEngine` for separately installed Python
  Linux AT-SPI, C# Windows UIA and Rust macOS AX drivers.
- OS-specific accessible controls with explicit unsupported-action errors,
  bounded trees, password redaction and owned application lifecycle.
- C++ Qt Widgets/Quick bridge, now including real Quick ComboBox selection for
  supported non-editable controls with a closed popup.
- Deterministic CLI default initializer, Qt/desktop presets, corrected source
  locations for paths with spaces, and bundled help guidance.

Tests remain TypeScript. Native-language test-authoring SDKs, global OS input,
OS-driver screenshots, generic custom-painted controls and hybrid DOM/native
context switching are not included.

## Verification for this candidate

Actual verification and remaining blockers are listed in the delivery's validation
summary. The prior candidate's [historical results](docs/development/history/validation-rc0.md)
are retained separately and are not substituted for current checks.

- Linux Qt 6.4.2 offscreen: fresh GCC build; 4 CTest suites/91 rows, selected
  Widgets and Quick end-to-end tests, and planted wrong-result rejection passed.
- Retained integrations: Playwright subset 241 passed (CDP attach/recovery files
  excluded due to the previously established host restriction), agent-device 92
  passed with five unavailable-simulator skips, GitHub 19 and OAuth 62 passed.
  OAuth/provider behavior uses mocks.
- Full core unit/integration suite: 1,879 passed across all 163 files, zero
  failures, three existing environment-specific skips.
- Shared desktop integration: 76 native package tests passed, including real
  sidecar/target processes with a fake protocol provider and the real Python protocol host. This qualifies the
  TypeScript integration and ownership behavior, not OS accessibility APIs.
- Python AT-SPI: 53 portable tests passed; actual GI/GTK imports and API symbols
  verified. Live D-Bus preflight failed due to host socket policy.
- C# UIA: driver and WPF fixture cross-compiled with zero warnings/errors; 34
  portable checks passed. No Windows GUI execution.
- Rust AX: 21 portable tests passed, plus formatting and driver/AppKit FFI
  typechecks. Apple frameworks were not linked and no macOS GUI ran.
- Onboarding/source-path regressions: 129 focused tests passed; CLI/Qt/desktop
  generated configs load against the installed package contracts.
- Existing boundary regressions: process 36, checks 17, HTTP 16, terminal 38 passed.
- Full workspace lint, dead-code, builds/typechecks, error reference and local
  documentation checks passed after the final rename/integration.

- Exact six-tarball consumer: installation/reinstall, default initializer and first
  CLI test, desktop API imports/types, correct failure verdict/source paths and
  dependency audit passed (zero reported installed-kit vulnerabilities).
- CLI/HTTP verification passed for Python/C#/Rust: nine positive and six intentional
  assertion failures, with cleanup checked; C++ CLI three positive cases and its
  planted defect also passed.

Further final checks are recorded in the accompanying validation evidence. Native
OS driver unit/compile checks and live accessibility checks must be distinguished.

## Platform gates

**The new OS drivers are experimental until their real platform checks pass.**
The current Linux host denies AF_UNIX sockets required by D-Bus, so real AT-SPI
GTK testing cannot complete here. Windows UIA and macOS AX require their respective
native OS, interactive desktop and permissions. No mock or cross-compilation result
is reported as a pass for these environments.

`desktop-contracts.yml` builds/tests the language backends and exercises GTK on
an eligible Linux CI host. `desktop-live.yml` runs native acceptance scripts on
prepared interactive self-hosted Windows/macOS/Linux desktops. Workflow source is
not evidence those jobs have run. Retain successful results before promoting each
profile to supported. The same rule applies to every toolkit/version combination.

Full browser CDP, mobile hardware/simulators and live model-provider qualification
remain separate gates. Optional web/mobile engines are preserved from the MIT base;
exclude any distribution whose provenance or license obligations cannot be met.
Previous private Expo-demo dependency advisories are recorded in the historical
report and have not been represented as cleared by this desktop update.

The source ZIP contains repository files and a checksummed six-package JavaScript
install kit. Compilers, runtimes, OS libraries, browsers, build caches and a populated
package-manager cache are external prerequisites; it is not a cold offline SDK bundle.

Machine-readable declared profiles: [support-profiles.json](docs/development/support-profiles.json).
