# @e2e-platform/process

## 0.2.0-rc.1

### Minor Changes

- Rename the unpublished fork to e2e-platform, add separately installed desktop accessibility sidecars with explicit capabilities and platform gates, complete Qt Quick ComboBox selection, and make CLI scaffolding usable with the local installation kit. Tests continue to use the shared TypeScript runner; OS drivers require their documented native platform qualification.

## 0.2.0-rc.0

### Minor Changes

- Coordinate the locally installable hardening candidate across all public modules.
  Correct confidentiality, lifecycle, assertion and packaging regressions; add
  Python, C# and Rust CLI/HTTP examples and extension contracts. Align security,
  support and offline setup documentation with the implemented fork behavior.

  This is a prerelease candidate. Registry publication, namespace ownership,
  Windows/macOS runtime qualification and additional GUI framework adapters are
  separate release requirements.
- Add extensible, immutable launch profiles for explicit Python interpreters,
  built .NET assemblies, and native executables such as Rust binaries. Keep
  logical application identity separate from optional build fingerprints and
  pass argument arrays directly without a shell.
- c79d60c: Establish the MIT-based fork and local installation kit under independent package
  names. Add extensible process supervision, output validators, authenticated native
  transport, cooperative Qt integration, terminal sessions and bounded HTTP checks.

  Integrate native launch configuration and lifecycle diagnostics with the MIT
  runner, explicitly forbid model access when configured, and fail attempts on late
  native faults. Protect known secrets in runner-controlled output, restored
  sessions and artifacts. Omit untrusted HTTP error causes that could disclose
  request contents. Include positive, planted-failure and installed-consumer checks.
  Remove the upstream telemetry destination: the fork CLI collects and sends no
  usage events, including when a compatibility preference is enabled.

### Patch Changes

- Updated dependencies [45c08b1]
- Updated dependencies [d438348]
- Updated dependencies [b9abd60]
- Updated dependencies [c1d23b2]
- Updated dependencies [ea27708]
- Updated dependencies [195bd0d]
- Updated dependencies
- Updated dependencies [da6b939]
- Updated dependencies [fb6e336]
- Updated dependencies
- Updated dependencies [c79d60c]
- Updated dependencies
- Updated dependencies [f09b69e]
- Updated dependencies [fb6e336]
- Updated dependencies [e9c2914]
- Updated dependencies
  - @e2e-platform/core@0.2.0-rc.0
