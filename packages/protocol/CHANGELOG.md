# @e2e-platform/protocol

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

- Bound OAuth network and refresh operations, preserve independent cancellation for shared refresh callers, and redact credential-bearing provider diagnostics. Correct fork CLI recovery commands and successful help exits.

  Clean every generated package build and validate public entries plus source/output inventories before packing. Require core, script, cross-platform command and Linux Qt qualification before a manual local-kit artifact can be uploaded; no registry publishing is enabled. Candidate package publication tags are coordinated.
