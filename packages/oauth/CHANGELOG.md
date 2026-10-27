# @e2e-platform/oauth

## 0.2.0-rc.5

### Patch Changes

- Prepare a coordinated candidate with bounded macOS process-group shutdown
  retries and safe recognition of the pnpm 12 Windows launcher. Preserve failures
  for persistent permission denial and invoke package managers without a shell.
  Identify native cleanup failures by fixed lifecycle stages and recognized
  system error codes without exposing arbitrary extension error messages or data.
  Synchronize terminal overflow qualification after the final test operation and
  record hosted browser/CDP and language evidence separately from unrun GUI gates.

## 0.2.0-rc.4

### Patch Changes

- Prepare a coordinated candidate with supervised desktop shutdown classification,
  complete redacted startup diagnostics, isolated macOS environment verification,
  and a numeric-loopback Python HTTP fixture without hostname resolution.
  Record hosted GTK qualification separately from portable driver checks and
  interactive platform acceptance that remains outstanding.

## 0.2.0-rc.3

### Patch Changes

- Qualify a coordinated candidate with corrected Windows process environment isolation,
  GI-qualified Linux AT-SPI text access, sanitized startup diagnostics, portable path
  checks, and deterministic planted-defect verification. Retain Windows SystemRoot
  for OS initialization unless explicitly overridden or removed.

## 0.2.0-rc.2

### Patch Changes

- Prepare the independent AhmedAredah/e2e-platform prerelease with canonical package
  metadata, corrected CI pins and source-build instructions, and complete inherited
  license attribution. Preserve descendant cleanup and serialize MCP session teardown;
  omit oversized terminal fields without leaking secret prefixes, and reject malformed
  UTF-8 at native and HTTP JSON boundaries. Harden desktop mutation uncertainty,
  password lifetime redaction, selection authorization and serialized response budgets.
  Native operating-system live qualification remains a release gate.


Also treat missing semantic values as unknown in positive and negated assertions,
serialize startup/disposal cleanup, recognize Android password metadata, and
withhold non-atomic secure mobile screenshots. Browser observations omit oversized
fields whole. GitHub and OAuth failures no longer expose response or parser content.

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

### Patch Changes

- Bound OAuth network and refresh operations, preserve independent cancellation for shared refresh callers, and redact credential-bearing provider diagnostics. Correct fork CLI recovery commands and successful help exits.

  Clean every generated package build and validate public entries plus source/output inventories before packing. Require core, script, cross-platform command and Linux Qt qualification before a manual local-kit artifact can be uploaded; no registry publishing is enabled. Candidate package publication tags are coordinated.
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

---

> Historical upstream changelog, preserved from the MIT base. Package names and
> versions in this section refer to TesterArmy releases. They are not fork releases.

## 0.1.0-canary-20260917213813

### Minor Changes

- [#335](https://github.com/tester-army/e2e/pull/335) [`15081f3`](https://github.com/tester-army/e2e/commit/15081f306837ebe1040fbcb2e63bd2efe283faaa) Thanks [@okwasniewski](https://github.com/okwasniewski)! - Sign in with a personal subscription instead of an API key. The new `@e2edev/oauth` package runs the OAuth flows for ChatGPT Plus/Pro (the Codex sign-in, browser or device code), GitHub Copilot (the GitHub CLI's login or a device flow for your OAuth App), and SuperGrok / X Premium+ (device code), stores the tokens in `~/.config/e2e/oauth.json`, refreshes them ahead of expiry, and exposes each plan as an AI SDK model: `chatgpt('gpt-5.5')`, `copilot('claude-sonnet-5')`, `grok('grok-4')`. The e2e CLI gains `e2e login <provider>` and `e2e logout`, and `e2e init` offers the three subscriptions next to the gateways.
