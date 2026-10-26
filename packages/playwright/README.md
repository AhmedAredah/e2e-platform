# @e2e-platform/playwright

> Fork installation: these package names are local release identities. Use the
> core kit in [INSTALL.md](../../INSTALL.md), then build and pack this optional
> module locally. The six-package kit excludes this engine. Registry availability
> is not established.

The browser engine for [`@e2e-platform/core`](../e2e/README.md), built on
[Playwright](https://playwright.dev).

`@e2e-platform/core` ships no engine of its own: every target names the engine that drives
it, and this package is the one for browsers. It implements the public
`@e2e-platform/core/engine` contract, so a device or desktop engine plugs into the same
seam with no privilege either way.

## Install

From the Git checkout, run `pnpm install --frozen-lockfile` and `pnpm build`, then
pack this optional module with
`pnpm --filter @e2e-platform/playwright pack --pack-destination /absolute/path/to/tarballs`.
Install the core kit into your test project first. From that project's directory,
replace the tarball path below with the actual filename emitted by `pack`:

```bash
npm install --save-dev /path/to/e2e-platform-playwright-0.2.0-rc.2.tgz playwright@1.63.0
npx --no-install playwright install chromium
```

Bring your own Playwright: `playwright` is a peer dependency (`>=1.63.0 <2`),
not something this package installs. An app that already depends on Playwright
keeps its version, one copy in `node_modules`, and one browser cache. A version
outside the range may be rejected by your package manager as an unmet peer
(npm's `ERESOLVE`), so upgrade `playwright` within the range.

```ts title="e2e.config.ts"
import type { E2EConfig } from '@e2e-platform/core';
import { playwright } from '@e2e-platform/playwright';

export default {
  modelPolicy: 'forbid',
  targets: [{ name: 'web', engine: playwright({ url: 'http://localhost:3000' }) }],
} satisfies E2EConfig;
```

The example expects your application to be serving `http://localhost:3000`.
Run deterministic tests with `npx --no-install e2e-platform run --no-model`.

The engine declares the app it drives. App options: `url` (the base URL
`app.open()` opens; required once a test navigates), `command` (a process the
runner starts before the run and stops after it, with `readyUrl` to poll,
default `url`), `environment`
(`test`, `staging`, `production`; inferred from the host), and `identity` (a
stable cache and session key when the origin is ephemeral). Browser options:
`browser` (`chromium`, `firefox`, `webkit`; default `chromium`), `viewport`
(`{ width, height }`; default 1280x720), `testIdAttribute` (the attribute
`getByTestId` and a node's `testId` read; default `data-testid`), and
`connect` — attach to a remote browser over CDP instead of launching a local
one.

### Attaching to a remote browser (`connect`)

Set `connect.cdpEndpoint` to attach over the Chrome DevTools Protocol rather
than launch. The resolver is async and called at worker init, and again at the
start of any attempt that finds the session dropped, so a hosted browser whose
endpoint is provisioned per run — a cloud session URL that is not known at
config load — resolves each time it is needed. The resolver receives an
`AbortSignal` that fires when the init or attempt is cancelled or exceeds its
budget; a browser that connects after that is detached, never used. CDP attach
is chromium-only, and disposing the engine detaches the session without
killing the remote process the host owns.

```ts
engine: playwright({
  connect: { cdpEndpoint: async () => acquireCloudBrowserSession() },
});
```

For transport recovery, add `connect.reconnectEndpoint(signal)`. This opts
into the remote browser's persistent default context. `cdpEndpoint` then
provisions a fresh, dedicated browser for every attempt, including retries;
`reconnectEndpoint` must return that same browser after a disconnect. The
engine verifies the default context ID and active page target ID, clears stale
references, and never repeats a dispatched operation. A missing target fails
the attempt. The host owns deleting the remote browser after cleanup.

This mode does not support `headers`, `basicAuth`, context reset, or session
state capture and restore. Recording resumes after reconnect, but a segment
lost during the disconnect remains unavailable. See the
[Playwright reference](../../docs/reference/playwright.mdx#recovering-a-cdp-transport)
for the lifecycle and ownership contract.

## The `web` fixture

The engine contributes `web`: navigation, routes, cookies, dialogs, frames,
downloads, keyboard and mouse, plus `expect(web).toHaveURL()` and
`toHaveTitle()` and `toHaveClass()`. Import `test` from this package to have it
typed; it is the same runtime `test` as `@e2e-platform/core`'s.

Route and dialog callbacks belong to the attempt that started them. Before the
verdict and after context cleanup, the runner waits for callbacks already in
progress within `cleanupTimeout` and reports their unobserved failures. A final
callback cannot silently pass just because no later browser operation follows it.
Settlement uses one deadline, honors cancellation, and does not wait for future
events or application background activity. JavaScript handler code cannot be
forcibly interrupted; a handler that does not finish fails settlement with
`CLEANUP_TIMEOUT`, while browser cleanup still runs.

```ts
import { test } from '@e2e-platform/playwright';
import { expect } from '@e2e-platform/core';

test('signs in', async ({ app, screen, web }) => {
  await app.open('/login');
  await screen.getByLabel('Email').fill('user@example.test');
  await expect(web).toHaveURL('/dashboard');
});
```

## Browsers

A missing browser is downloaded once per run, in the runner process, after the
tests are collected and before the app starts: the progress prints in the run
log, the run's clock starts only once the download is done, and no launch or
test timeout ever includes it. Workers launch the browser the runner installed.

In CI, install browsers as their own step instead, so the cost is visible and
cacheable:

```bash
npx --no-install playwright install chromium --with-deps
```

`--with-deps` also installs the system libraries a slim container image lacks.

## Documentation

Oversized model-facing names, document titles and text are omitted whole before
runner redaction; locator reads retain complete fields. This prevents a clipped
secret prefix from escaping full-value redaction.

Use this fork's [Playwright reference](../../docs/reference/playwright.mdx) and
[installation guide](../../INSTALL.md#browser-and-mobile-applications). The
upstream website describes a different distribution.
