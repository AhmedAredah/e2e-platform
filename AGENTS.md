# AGENTS.md

`@e2e-platform/core` — an agentic end-to-end testing framework. pnpm monorepo, ESM only,
TypeScript 7.

This fork begins at MIT upstream commit `e9c2914c6d8f8d664d820b13a1fa454e9247e94b`.
Do not import later Apache-only upstream changes as MIT. Record independently
implemented compatibility changes and preserve dependency licenses; see
`docs/development/LICENSING.md`. Fork package versions begin at 0.1.0.


## Contracts

There is no separate spec. The code is the contract, pinned in three places:

- The emitted `packages/e2e/dist/index.d.ts` (and `dist/engine/index.d.ts`)
  is the public API. `packages/e2e/tests/types/sdk-types.ts` holds compile-time
  assertions (`@ts-expect-error` lines) for the parts that are easy to loosen
  by accident; it runs under the package `typecheck`, never under vitest.
- Wire formats live in `packages/e2e/schema/*.schema.json` (report-1,
  session-1, agent-judgment-2, agent-tool-1, and the deprecated agent-judgment-1) with a valid and an invalid fixture
  each. Integration tests validate every generated report and session envelope
  against them; `tests/unit/schema-fixtures.test.ts` checks the fixtures. A
  wire change edits the schema, both fixtures, and the producer in one review.
- Security invariants are the list under Gotchas below, enforced by tests in
  `tests/integration/agent-policy.test.ts` and the secret-ledger unit tests.
- Behavior changes update the matching `docs/**/*.mdx` page in the same
  change, including "not implemented yet" callouts, and `skills/e2e/` when the
  changed surface is described there. `scripts/check-error-codes.ts` (in
  `pnpm check`) fails when an error code in source is missing from
  `reference/errors.mdx` or `reference/engine.mdx`, or documented but raised
  nowhere.

The extension contracts and support boundaries are described in `SUPPORT_MATRIX.md`
and the package READMEs. Record design rationale with changes and validation.

## Layout

- `packages/e2e` — the reusable `@e2e-platform/core` package: SDK surface, runner, CLI,
  `@e2e-platform/core/engine` contract. Core knows the contract and never an engine's
  internals: no `Web`, `browser`, `page`, `route`, or `playwright` noun lives in
  `src/` (grep for them; zero hits is the invariant). The one exception is the
  `e2e-platform init` scaffold presets in `src/cli/init/engines.ts`, which write the
  user's config and so name engine packages as text; the package build records
  the sibling packages' versions in `dist/cli/init/sibling-versions.json` for the
  ranges they write. Each preset owns its prompt label, dependencies, config,
  example, and run command; interactive choices derive from this list. These
  presets never import engine implementations.
  - `src/run/` runner core (scheduler, units, workers, retries, sessions;
    `standalone.ts` opens one attempt with no test body for hosts),
    `src/collect/` registration+selection, `src/locator/` locator AST/engine,
    `src/agent/` the agent (the `act` executor socket plus the judgment
    methods), `src/mcp/` the `e2e-platform mcp` server (a live session that rides
    the `act` socket with a queue executor so every MCP call is a harness
    action).
- `packages/playwright` — the reusable `@e2e-platform/playwright` package: the
  browser engine, built with the public `defineEngine`, contributing the
  `web` fixture and `expect(web)`. It depends on `@e2e-platform/core` (peer), never the
  reverse; a target names it explicitly as `engine: playwright()`. There is
  no default engine and no well-known id registry in core. It imports from
  `@e2e-platform/core/engine` only: the semantics every engine must reproduce
  (error taxonomy, text and URL matching, assertion polling, JSON-value rules)
  are exported there, and there is no `@e2e-platform/core/internal` subpath.
- `apps/testbed` (`@e2e-platform/testbed`, private) — dogfood project that
  consumes the **built** packages like a real user would: the playground app
  where every runner feature (sessions, routes, downloads, frames, uploads,
  serial groups, the executor seams, verdict edge cases, the reporter under
  stress, `explore`) has a deterministic test. Hard UI surfaces belong to the
  benchmarks, not here.
- `apps/web-benchmark` (`@e2e-platform/web-benchmark`, private) — a Next.js app of
  self-contained hard-surface scenarios (shadow DOM, canvas, iframes, native
  dialogs, planted bugs) at `/e/<slug>`, copied from the tester-army web
  benchmark, plus the e2e suites written against them (`tests/` and
  `tests-agent/`; deterministic tests gate PRs and model-backed suites are manual).
  Scenario files are copies: keep diffs against
  the source minimal so scenarios port both ways, and never fix a planted bug.
- `apps/mobile-benchmark` (`@e2e-platform/mobile-benchmark`, private) — an Expo
  app of hard mobile surfaces (merged or hidden accessibility trees, native
  alerts over modals, keyboard-covered submits, virtualized lists, a WebView,
  OS permission and payment sheets), copied from the tester-army mobile
  benchmark, plus the e2e suites on the `@e2e-platform/agent-device` engine
  (`tests/` locators only, `tests-agent/` one `agent.act` per scenario).
  Neither runs in CI: no simulator there. Scenario files are copies: keep
  diffs against the source minimal, and name no company a scenario was
  distilled from.
- `docs/` (the Mintlify docs site; pages are the `.mdx` files under `docs/`,
  navigation, theme, and redirects in `docs/docs.json`, extra CSS in
  `docs/style.css`; `docs/examples/` is typechecked and shown verbatim in the
  quickstart, kept in sync by `scripts/check-docs-examples.ts`).
- `skills/e2e/` — the agent skill for consumers: `SKILL.md` plus
  `references/<topic>.md`, one per `e2e-platform guide` topic. The fork ships its local
  copy; installing a current upstream skill is not equivalent. The `@e2e-platform/core` build copies it to `packages/e2e/skills/`
  (gitignored) so the packed package ships it; `src/cli/skill.ts` reads
  that copy first and the repo source as the fallback, and `e2e-platform init` writes
  it into a project's `.agents/skills/` and `.claude/skills/`.

- `packages/process`, `checks`, `native`, `terminal`, `protocol` — independent
  application boundary modules. Keep abstract contracts separate from concrete backends
  and use dependency injection for transports, drivers and validators.
- `native/linux-atspi`, `native/windows-uia`, `native/macos-ax` — separately installed OS accessibility sidecars. Keep protocol, provider, control and process ownership modules separate; never mark portable tests as live OS qualification.
- `native/qt` — C++17 Qt helper, control adapters, CMake export and native tests.
  New toolkit helpers belong in sibling directories; Qt internals are not an
  installed ABI for third-party adapter plugins. The separate versioned public
  `ControlAdapter` contract permits source-level registration before startup.
- `native/cpp-sdk` and `packages/cpp` — C++17 test-authoring client and its bounded
  runner host. Keep transport, semantic client, registration and host dispatch
  separate. Never trust a child exit code to erase a failed host operation.
- `native/windows-process` — optional Windows Job Object supervisor. Its protocol
  and lifecycle tests are independent of interactive desktop qualification.
- `examples/with-cpp-cli`, `examples/with-cpp-sdk`, `examples/with-qt` — real compiled consumer fixtures,
  including deliberate wrong-output scenarios that must remain detectable.
- `scripts/native` — verification and checksummed local install-kit tooling.
  Generated evidence belongs in ignored build/output folders, not source.

## Commands

Build first — nearly everything downstream consumes `dist`.

```bash
pnpm check:local    # lint -> dead-code -> build/typecheck -> error docs -> local docs checks
pnpm test           # builds, then vitest unit + integration
pnpm test:testbed   # builds, then runs the real CLI against the playground app
pnpm test:web-benchmark   # builds, then runs the real CLI against the benchmark scenarios
```

Focused work:

```bash
pnpm --filter @e2e-platform/core run build
pnpm --filter @e2e-platform/core run test:unit                       # unit only, no build
pnpm --filter @e2e-platform/core exec vitest run tests/unit/scheduler.test.ts
pnpm --filter @e2e-platform/core exec vitest run -t 'name fragment'
pnpm --filter @e2e-platform/playwright run test
pnpm --filter @e2e-platform/testbed run test:headed
```

- Package `test` scripts do **not** build. Root `build` and `test` order the
  packages explicitly rather than relying on topological sort, because `@e2e-platform/core`
  devDepends on the playwright engine for its browser-backed integration tests
  while the engine peer-depends on `@e2e-platform/core` — pnpm reports that cycle on every
  install.
- `pnpm typecheck` runs `build` first, then per-package `typecheck`. The
  package `typecheck` covers `tests/**`, which is what makes
  `tests/types/sdk-types.ts` a test.
- Integration tests need Chromium: `pnpm --filter @e2e-platform/playwright exec
  playwright install chromium`. The Playwright engine's `prepare` hook
  also installs a missing browser once per run, in the runner, before `plan`
  is emitted and the run's clock starts.

## Non-obvious conventions

- **Relative imports carry the `.ts` extension** (`rewriteRelativeImportExtensions`).
  `import { x } from '../internal/ids.ts'` — not `.js`, not extensionless.
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on. Optional
  properties use the conditional-spread idiom; `oxc/no-map-spread` is disabled
  for exactly that reason.
- Lint is `oxlint` with `correctness`/`suspicious`/`perf` as errors and
  `style`/`pedantic` off. `no-await-in-loop` is intentionally off (sequential
  execution is the runner's contract).
- `pnpm check:dead-code` runs [fallow](https://github.com/fallow-rs/fallow)
  (`.fallowrc.json`): unused files, exports, dependencies, and duplicate
  export names fail CI. An export whose only consumer is a test is dead
  production API - make it module-private or move it. The class-member rule is
  advisory (`warn`) because it misses getters and callback-invoked methods.
- JSDoc on new functions; avoid inline comments unless they explain *why*.

## Testing quirks

- Vitest 5, `pool: 'forks'`, two projects. `integration` is capped at
  `maxWorkers: 3` and runs in a later group — do not raise it; CPU starvation
  produces timeouts indistinguishable from real failures.
- Integration tests write throwaway projects into
  `packages/e2e/tests/tmp-projects/` (gitignored) and import the runner from
  `dist/` via a non-literal specifier so the fixture's `@e2e-platform/core` self-reference
  shares one registry. Stale `dist` means confusing failures — rebuild.
- Testbed suites beyond the default one never gate a PR: `test:agent` /
  `test:dogfood` (real model calls, need `AI_GATEWAY_API_KEY`, optional
  `E2E_MODEL=provider/model-id`, the testbed's own override) run only by manual
  `.github/workflows/agent.yml` dispatch. Both run
  against local deterministic apps, so a failure there is ours.
- Agentic assertions must be model-portable: assert on meaning (`toContain`)
  and pair each agentic step with a deterministic locator check.

## Inspecting agent runs with unbox-ai

`e2e-platform run --ai-trace` records every model call of a run to `.e2e/ai-trace.json`
in the AI SDK devtools database shape (`{ runs[], steps[] }`). One run per
agent step, named `<test title> · <api> "<label>"`; one entry per model round
trip (an `act` turn, a `waitFor` poll, a judgment repair round) with the exact
prompt, the tool definitions and their JSON schemas, the response, usage, model
latency, and provider metadata. Recorder: `src/internal/ai-trace.ts` (an AI SDK
`registerTelemetry` integration, attributed through an async-local scope set
in `run/execute.ts` and `run/steps.ts`; workers drain on `unit-done`).

Use [unbox-ai](https://github.com/tester-army/unbox-ai) to read it — never
`cat` or Read the file, it is megabytes of resent context. The skill in
`.claude/skills/unbox-ai/SKILL.md` has the full workflow and recipes (other
agents: `npx skills add tester-army/unbox-ai`). Start wide, then drill:

```bash
AI_GATEWAY_API_KEY=... pnpm --filter @e2e-platform/testbed test:agent -- --ai-trace --no-cache
npx unbox-ai runs apps/testbed/.e2e/ai-trace.json            # one line per agent step
npx unbox-ai summary apps/testbed/.e2e/ai-trace.json --run 3 # one step: turns, tokens, caching
npx unbox-ai tools apps/testbed/.e2e/ai-trace.json --run 3   # what the agent called, and how often
npx unbox-ai event apps/testbed/.e2e/ai-trace.json 2 --run 3 # one turn's new messages
npx unbox-ai compare apps/testbed/.e2e/ai-trace.json --run 3 --run 4 --trajectory
```

This is how to debug an agentic step: a wrong node id, a loop guard firing, a
prompt or tool description change, or where the tokens went. Reach for it
before changing prompts in `src/agent/`, and again after, with `compare`. In
integration tests, pass `runOptions: { aiTrace: true }` and read the file from
the fixture project (`tests/integration/agent-ai-trace.test.ts` shows how).

- Steps the trace cache replays make no model call and leave no run; use
  `--no-cache` when you want the whole flow traced.
- Cost shows as `-` in unbox-ai (the devtools shape carries none); the AI
  Gateway's `marketCost` is in each step's `output.providerMetadata`, and the
  `--debug` step table prints dollars.
- Live view while a suite runs: `npx unbox-ai devtools` in the project
  directory, then `E2E_DEVTOOLS=1 ... test:agent -- --workers 1` (the testbed
  agent config registers `@ai-sdk/devtools`; that recorder is one database
  per process, hence one worker). Prefer `--ai-trace` for anything to keep.
- "Trace" means three things here: the trace cache (`trace-1`, recorded
  actions under `.e2e/cache/`), the Playwright trace artifact, and this AI
  trace. Say which.

## Gotchas

- Status prose drifts. `packages/e2e/README.md` and the docs pages can claim
  things that have since landed or been removed (the located verbs and the
  locate cache are both gone, for example). Verify against `src/` before
  repeating or relying on any "not implemented yet" list — and fix the prose
  when you find it stale.
- No implicit default model. One canonical model per slot: the one
  `createAgent({ model })` brought, else `agent.model`, serves `act`; the
  judgment calls (`assert`, `waitFor`, `extract`) use `judge` when one is
  configured the same way, else `model`. Two that differ within a slot are
  `INVALID_CONFIG`. A judgment never sees the prior-step ledger or the acting
  agent's summaries, only the instruction and the current screen. Without a
  model, the first
  `agent` acquisition in a run reports one run-level `MODEL_UNAVAILABLE` and
  stops the run (exit 2). No implicit target either: `targets` is required and
  each names its engine.
- Security invariants (fail closed when one cannot be enforced):
  - Registered secret values must be redacted at runner-controlled model,
    diagnostic and artifact boundaries as described in SECURITY.md. Explicit
    raw process logs and trusted application/test code require their own handling;
    arbitrary unknown secrets cannot be inferred. Model input is the redacted semantic tree (as text or, on request, the
    redacted node tree), masked pixels only when masking is proven and no
    secret was filled, and the sanitized prior-step records. Once a secret is
    filled the viewport stays pixel-tainted for the rest of the attempt. What
    an executor keeps in `attempt.memory` is its own; the harness never
    reports it.
  - A secret fill is authorized by the runner, not the model: authentic
    unresolved handle, a configured secret declared by the step, an enabled
    editable node with a compatible purpose, a current observation, and no
    control transfer since. The model never sees or picks the value.
  - Every model tool call is parsed into a closed schema and authorized
    immediately before dispatch; unknown tools or fields, stale observation
    refs, and denied destinations are `POLICY_DENIED`. Model text is never
    evaluated as code, selectors, shell, or config. App content, ledger text,
    and pixels are quoted as untrusted evidence with no policy authority.
  - Explicit navigation rejects `file:`, `data:` and `javascript:` URLs.
    There is no navigation or secret-fill origin allowlist and no general
    link-local/cloud-metadata network restriction. Redirects and popups are not
    rechecked. Do not promise these protections; see SECURITY.md.
  - Sessions are per-run, target-bound, AES-256-GCM encrypted with a
    memory-only key, and deleted at cleanup; payloads never enter diagnostics.
  - Reports escape contextually, strip terminal controls, generate artifact
    names, and never let a label become a path component.
  - Test, config, and engine code run with the runner's full OS authority;
    nothing here sandboxes them. Untrusted PR code belongs in an external
    sandbox with no secrets or write tokens.

- CI uses standard GitHub-hosted runners and SHA-pinned actions. The spec
  workflow checks Node 22.22.3 and 24.22.1. The C++ workflow adds Linux/macOS/Windows
  command and installation checks, Linux Qt offscreen/X11, Windows native/offscreen
  and macOS Cocoa/offscreen Qt validation. Workflow
  configuration alone is not evidence that an OS/toolkit has passed.
- Provider-backed jobs require explicit manual dispatch. Workflows do not send
  pull-request messages, publish packages or modify upstream repositories.
- The default documentation check is local and makes no Mintlify requests.
  `pnpm --filter @e2e-platform/docs run check:online` is a separate network operation.
- Commits use Conventional Commits. Keep PR descriptions about the final behavior
  and relevant validation. Retain third-party attribution in inherited tooling.
- User-visible changes add a Changeset. Peer ranges point from engines to core,
  never the reverse. The local fork reset to 0.1.0 is intentional; future version
  updates should use Changesets so dependent packages stay coordinated.
- Root `release` and `pack:native` create a checksummed seven-package installation kit;
  neither publishes. The release workflow is manual and uploads that kit as an
  artifact. No fork namespace ownership or registry publication is established.
- Each build stamps `dist/.build.json`; package `prepublishOnly` and kit packing
  validate that stamp. Build before packing. `pnpm run canary` only prepares a
  local coordinated snapshot; there is no automatic canary publishing command.
- Core's package name is `@e2e-platform/core`; its executable is `e2e-platform`. Document
  locally installed commands as `npx --no-install e2e-platform` or `pnpm exec e2e-platform`
  so instructions cannot fetch a different upstream package. The OAuth executable
  is `e2e-platform-oauth`. Preserve the on-disk consumer skill name `e2e`.
- Private applications are skipped by Changesets (`privatePackages: false`).
  Their dependencies and known audit findings remain visible and are distinct
  from the seven-package consumer kit.
