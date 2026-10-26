# Contributing

This fork extends an MIT upstream snapshot with reusable C++ application testing
modules. Start with [README.md](README.md), [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md) and
[AGENTS.md](AGENTS.md) for the architecture and conventions.

## License and contribution terms

The project source is MIT; see [LICENSE](LICENSE) and the
[provenance record](docs/development/LICENSING.md). Submit only work you can license
under those terms. Preserve notices and attribution. Do not copy later upstream
Apache-only implementation changes into this MIT fork without resolving their
separate license obligations. Runtime dependencies and Qt retain their own terms.

Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating. Consult
[SECURITY.md](SECURITY.md) before reporting a potential vulnerability. Fork-owned
community and security channels must be configured before a public launch; the
original project's contacts are not designated contacts for this fork.

## Development

Use the Node version range in package manifests and pnpm 12.3.4. Public modules
live in `packages/`; private browser/mobile regression applications live in
`apps/`; compiled helpers belong in `native/`; consumer applications belong in
`examples/`. Keep generated build trees, reports and caches outside tracked source.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check:local
pnpm test
```

Runner/browser integration tests require the matching Chromium installation:

```sh
pnpm --filter @e2e-platform/playwright exec playwright install chromium
```

C++ verification also requires CMake and a C++17 compiler. Qt checks need a matching
Qt 6 kit and its runtime modules. See [verification/README.md](verification/README.md)
for compiled example, installed CMake consumer, deliberate failure and npm kit
checks. Record the actual environment and any unavailable qualification. Do not
claim an OS or toolkit passed solely because a workflow exists for it.

Default documentation checks are local:

```sh
pnpm docs:check
pnpm docs:dev
```

`docs:dev` starts the optional Mintlify preview. The separate docs `check:online`
command contacts Mintlify; it is not part of the offline gate. Provider-backed
suites spend model calls and require explicit manual invocation.

## Public contracts and extension design

A contract change updates its implementation, types, tests and documentation
in the same review:

- Public TypeScript declarations and compile-time API assertions.
- Configuration, CLI flags/exit codes and environment variables.
- Engine capabilities, deadlines, cancellation, observation completeness and cleanup.
- JSON Schemas and valid/invalid fixtures for reports, sessions and agent protocols.
- Native helper protocol and installed CMake usage.

Use abstract classes for reusable backend contracts and inject drivers, transports
and validators. Keep toolkit behavior out of core. New helpers must declare their
capabilities honestly and include deliberate wrong-output or failure cases; a
successful exit alone does not validate the application result. Qt's internal
adapter headers are not an installed third-party plugin ABI.

The emitted declarations are the public API. A module under `internal`, private
showcase code, raw reporter wording and model prompts are not stability promises.
Errors codes, wire semantics and exported interfaces are public contracts. Keep
behavior and documentation consistent rather than preserving stale claims.

## Changes and local releases

Use Conventional Commits. Explain the concrete behavior and relevant validation
in a PR, and add a Changeset for a user-visible change to any reusable package:

```sh
pnpm changeset
```

Private applications are skipped by Changesets. The initial fork reset to 0.1.0
is intentional; inherited changelogs describe upstream history, not published
fork releases. Future coordinated version updates use the local Changesets
configuration and plain changelog generator. No upstream GitHub release links
are generated for this fork.

```sh
pnpm pack:native
node scripts/native/install-kit-smoke.mjs
```

`pack:native` and root `release` create a checksummed six-package local installation
kit. The manual packaging workflow uploads an artifact. They do not publish to
npm or create a release PR. Package names are local fork identities until the
maintainer separately establishes registry ownership, support channels and a
publication policy. No automatic publishing credentials are required.

Every package build stamps its output; packing checks that the compiled version
matches package metadata. The consumer smoke check installs local tarballs into
a fresh project, verifies licenses, imports public modules, runs passing and
intentionally failing tests, checks declarations and audits the installed tool.

Before a public release, document compatibility changes and upgrade paths.
Coordinate engine/core peer ranges so compatible packages can be installed
together. Security fixes may require immediate removal of unsafe behavior; explain
that decision with the fix and its regression test.
