# @e2e-cpp/native

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
- Expose a protected native process factory and typed acquisition context for project-owned protocol sidecars. Preserve authenticated readiness, restart and process supervision, and drain sessions returned after cancellation or deadline expiry. Arbitrary unowned endpoint attachment remains unsupported.

  Ship versioned protocol-v1 JSON schemas and golden conformance fixtures, with tests against the public engine vocabulary and native parser. Runtime authentication, masking, lifecycle and bounds remain authoritative.

### Patch Changes

- Keep Qt sensitive-fill masking in helper-owned object lifetime state, reject covered Qt Quick pointer targets before dispatch, and omit whole oversized or NUL-containing source text fields so later secret redaction cannot receive partial values. Add native regression coverage for security-marker restrictions, lifetime reuse, screenshot masking, visual overlays and pointer grabs.
- Preserve worker verdicts and public protocol grammar while redacting confidential data, and deliver complete MCP responses independently of console buffering. Keep report/event identities coherent, validate worker control messages, and redact before clipping diagnostic text. Native observations now omit oversized fields whole rather than exposing partial secret values.
- Updated dependencies [45c08b1]
- Updated dependencies [d438348]
- Updated dependencies [b9abd60]
- Updated dependencies [c1d23b2]
- Updated dependencies [ea27708]
- Updated dependencies [195bd0d]
- Updated dependencies
- Updated dependencies [da6b939]
- Updated dependencies
- Updated dependencies [fb6e336]
- Updated dependencies
- Updated dependencies [c79d60c]
- Updated dependencies
- Updated dependencies [f09b69e]
- Updated dependencies [fb6e336]
- Updated dependencies [e9c2914]
- Updated dependencies
  - @e2e-cpp/core@0.2.0-rc.0
  - @e2e-cpp/process@0.2.0-rc.0
