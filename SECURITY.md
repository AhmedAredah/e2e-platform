# Security

The source guide for this fork is [docs/security.mdx](docs/security.mdx).
Upstream documentation describes a different distribution and may differ.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/AhmedAredah/e2e-platform/security/advisories/new)
for security issues in this fork. Reporting is enabled on this repository.
Do not post credentials or exploit details in a public issue. The original
project's contact is not this fork's support team.

## Supported versions

The reviewed candidate is 0.2.0-rc.5 on `mit-main`; the preserved upstream `main`
branch is not this candidate. No registry release, response-time commitment or
long-term maintenance window is established. Check [RELEASE_STATUS.md](RELEASE_STATUS.md)
for tested environments and unresolved dependency findings.

## Trust model

Two kinds of input exist here, and the line between them is the whole model.

**Code-trust.** Everything you run has your OS authority, with no sandbox in
between: test files, `e2e.config.ts`, custom tools, engines, and any
`command`, `services`, or `cache.store` you configure. A trace cache committed
to the repository is code-trust as well: the runner replays recorded actions
from it without asking the model, so a bad entry is a bad test, not a
compromise of the runner. If the code came from an untrusted pull request, run
it in an external sandbox with no secrets and no write tokens. The framework
will not protect you from your own dependencies.

**Untrusted model input.** Page content is evidence, never instructions.
Text, accessibility trees, and pixels from the app under test are quoted to
the model as untrusted; the runner, not the model, decides what a tool call
may do. Every model tool call is parsed into a closed schema and authorized
right before dispatch. Unknown tools or fields, stale observation references,
and denied destinations fail with `POLICY_DENIED`. Model text is never
evaluated as code, selectors, shell, or config.

Secret handles stay on the host. Registered static strings and provider values
resolved by the runner are redacted at runner-owned text boundaries: semantic
fields, executor prose, stdout/stderr, events, errors, reports, AI traces, and
text evidence. The filter recognizes raw, JSON-escaped, HTML-escaped, and
standard URL-encoded forms. A secret-bearing semantic node ID is refused
because rewriting it would no longer identify the same control.

Structured output preserves schema keys, control enums, generated IDs, hashes,
timestamps and numeric values. These are protocol metadata, not captured prose.
Public test, serial and scope identities use stable opaque aliases; configured
target and agent names are also aliased when confidential or when providers can
resolve new values. This keeps report, event and trace references consistent.
Workers transfer resolved values through private IPC before the parent publishes
their records. That channel is trusted, like the session-key transport; it is
not a public diagnostic log. MCP redacts complete messages before serialization,
so output buffering cannot retain part of a response frame.
Buffered worker output retains the pair that produced it. At a pair boundary,
an undecidable secret prefix is withheld rather than combined with another
pair's output. Artifact paths and store references are never rewritten into
invented locations: confidential references are omitted and the artifact is
marked `incomplete`, retaining its ID, size and hash. Test and serial artifact
directory names use full-input digests so clipped titles cannot escape filtering.

Diagnostics redact complete values before shortening them. Browser, terminal
and native observation producers that do not know the runner's secrets omit an oversized
field whole instead of exposing a potentially confidential prefix. The Qt
producer also omits fields containing NUL rather than normalizing their content.

Mobile observation pixels and screenshot artifacts are withheld whenever a
full accessibility capture detects secure controls. The mobile dependency does
not provide atomic tree/pixel masking, so painting old rectangles cannot prove
a moving password field is covered. Full-tree checks run before and after
capture, including in interactive-only observation mode. A refused observation
keeps its semantic tree; an explicit screenshot fails without writing an artifact.
Android native password flags are recognized, and ambiguous password labels,
values and descendants are omitted. This policy cannot identify secrets that
the application's accessibility implementation does not mark.

A secret fill is authorized from the runner's own observation. Once an opaque
secret, or a literal matching a registered secret, is filled, that live session
stays pixel-tainted; model and artifact captures are withheld when their safety
cannot be proved. The taint and full history of resolved provider values are
encrypted alongside saved engine state and restored before the engine restores
it. Session envelopes are bound to the run, target, engine and app identity,
expire within 24 hours, and are deleted at cleanup. The encryption key stays in
memory and worker IPC, never in the archive.

Playwright traces from tainted sessions are rewritten before registration;
binary entries are omitted because their pixels cannot be proven safe. Archives
with unreadable data or unrewritable multiline secrets are withheld. Video from
a tainted session is withheld; a required video then fails cleanup. Registered downloads and logs
must be UTF-8 text without NUL bytes and no larger than 8 MiB. They are redacted
before hashing or upload. Opaque, binary, oversized or undecodable downloads
and logs are deleted and recorded as incomplete with no artifact path. This
intentionally excludes binary download evidence; use a trusted custom workflow
outside the runner when such files are required. Redacted text is diagnostic
evidence and is not guaranteed to remain a replayable application data file.

Managed command and service logs redact currently known values, plus configured
command environment values of at least four characters, before writing bytes to
disk. Output filtering retains incomplete secret suffixes across writes,
including UTF-8 byte boundaries. Unreasonably large secret values cause output
to be withheld. Config console output is held until static declarations become
available; failed or excessive config output is omitted.

## Navigation and origins

A test or the agent may open any http(s) URL; `file:`, `data:`, and
`javascript:` are denied. There is no origin allowlist, on navigation or on
secret fills. A click, a redirect, or a popup reaches another origin just as
a typed URL would, so a gate on typed navigation guarded nothing; and a
secret is only ever typed into a field the test itself handed to the step, a
password only into a password field, so an origin gate on the fill guarded
against a model mistake at the cost of configuring every sign-in flow that
leaves the app's domain. Treat a target whose app can send the agent
elsewhere as one the agent may follow there, with the secrets the step was
given. If a threat model ever calls for an origin allowlist again, it comes
back as an opt-in.

Two things still key on the site of the target's `url`, its registrable
domain: the browser engine's `headers` reach the site and no other host, and
child frames off the site are dropped from observations.

## Telemetry and outbound traffic

The fork CLI has no telemetry destination or ingestion key. It does not collect
or transmit usage events, including in CI. The inherited preference commands
remain available, but `e2e-platform telemetry enable` cannot activate a transport.
`E2E_TELEMETRY_DISABLED` and `DO_NOT_TRACK` remain recognized opt-out flags.
Transport tests use an explicitly injected mock destination.

There is no crash reporting and no update check. Framework-managed connections
can include:

- the model endpoint owned by the AI SDK instance in your config (agent steps
  only; deterministic suites make no model calls, and cached steps replay
  without one)
- `readyUrl` probes against the app the runner starts
- Playwright browser downloads, once, when Chromium is missing
- OAuth provider authorization, device-code and token-refresh endpoints when
  subscription authentication is configured
- configured artifact stores and optional GitHub reporting integrations
- the app under test, and whatever that app itself loads

Trusted test/config code, custom tools, engines and configured commands can make
additional connections under their own authority. This is not a network sandbox.

`e2e-platform run --ai-trace` writes every model call to a local file. Nothing uploads
it.

## Known non-goals

This is a protection boundary for registered values in runner-controlled
outputs, not a sandbox or a general data-loss-prevention system. Arbitrary test,
config, engine and application code can bypass streams, write its own files,
open sockets, or invoke model APIs directly. Values printed before they become
known, credentials never registered with the runner, provider exceptions before
a value is returned, and arbitrary encodings or transformations cannot be
reliably recognized. App and service processes may also know secrets that their
runner process has never resolved. Keep credentials out of application output,
and register static secrets before running code that may emit them.

Registered file paths must remain within the attempt evidence directory.
Symlinks that resolve outside it are not uploaded. Trusted producers must finish
writing a file before registering it; concurrent mutation after registration is
outside the artifact contract. Source files, user-chosen destination paths,
pre-existing logs, and external storage services remain under the caller's
control. Review diagnostics before sharing them.
