# @e2e-platform/agent-device

> Fork installation: these package names are local release identities. Use the
> core kit in [INSTALL.md](../../INSTALL.md), then build and pack this optional
> module locally. The seven-package kit excludes this engine. Registry availability
> is not established.

The mobile engine for [`@e2e-platform/core`](../e2e/README.md), built on
[agent-device](https://github.com/callstack/agent-device): iOS simulators and
Android emulators through the same `@e2e-platform/core/engine` contract the browser engine
implements. A test written against `screen`, `expect`, `app`, and `agent` runs
on a device target unchanged; nothing in `@e2e-platform/core` core knows this package exists.

## Install

From the Git checkout, run `pnpm install --frozen-lockfile` and `pnpm build`, then
pack this optional module with
`pnpm --filter @e2e-platform/agent-device pack --pack-destination /absolute/path/to/tarballs`.
Install the core kit into your test project first. From that project's directory,
replace the tarball path below with the actual filename emitted by `pack`:

```bash
npm install --save-dev /path/to/e2e-platform-agent-device-0.2.0-rc.7.tgz
```

`agent-device` needs Xcode with an iOS simulator runtime, or the Android SDK
with a booted emulator. Run `npx --no-install agent-device doctor` once before
handing the target to the runner. The npm dependency supplies `agent-device`, not
Xcode, Android SDK tools or device images.

After installing the local tarball, you can run `npx --no-install e2e-platform init`
and choose **Mobile (iOS/Android)** with no model. Init preserves the installed
file dependency; running it before installing this engine would offer to resolve
an unpublished fork package from the registry. Alternatively create this
deterministic Android configuration yourself:

```ts title="e2e.config.ts"
import type { E2EConfig } from '@e2e-platform/core';
import { agentDevice } from '@e2e-platform/agent-device';

const settings = agentDevice({ platform: 'android', app: 'com.android.settings' });

export default {
  modelPolicy: 'forbid',
  targets: [{ name: 'android', engine: settings }],
  workers: 1,
} satisfies E2EConfig;
```

On macOS with a booted iOS simulator, use
`agentDevice({ platform: 'ios', app: 'Settings' })` instead and adjust the target
name and test labels. Configure only platforms available on the host. To use
`agent.act`, choose an explicit model/provider and remove `modelPolicy: 'forbid'`;
see the [model-backed configuration](../../docs/reference/agent-device.mdx#engine).

A test written against `agent`, `app`, `screen`, and `device` runs on both
targets unchanged. Only a check that names a platform label (`General` on iOS,
`Network & internet` on Android) needs `platforms: ['ios']` or
`platforms: ['android']` on the test.

Options:

| Option | Meaning |
| --- | --- |
| `platform` | `'ios'` or `'android'`. |
| `app` | Bundle id, package, or display name opened fresh at the start of every attempt. Also unlocks `app.restart()` and `app.clearState()`. |
| `appPath` | An iOS `.app` bundle or Android `.apk` installed once per worker before the first attempt, resolved against the project root. Without `app`, the installed bundle id or package is the app opened per attempt. |
| `device` | Simulator or emulator name or UDID. A list is a pool: one worker per entry, worker slot `n` driving the `n`th. Omitted, every booted device of the platform is the pool, as many as the run has slots. |
| `session` | agent-device session name, before the worker slot: slot `n` drives its device under `<session>-<n>`, `e2e-<target name>-<n>` by default. One run per session at a time. |
| `snapshot` | `'full'` (default, includes static text) or `'interactive'` (actionable nodes only). |
| `settle` | For agent actions: milliseconds the UI must hold still after an action before the agent observes again, default `150`; `false` skips the wait. A test's own steps never settle; `expect` verifies their outcome. |
| `transition` | For a test's steps: milliseconds a control that appeared or moved with the last action gets to finish arriving before it is acted on, default `500`. Controls already in place before the action are acted on at once. |

Every optional value also accepts `undefined`, so a config passes
`device: process.env.E2E_DEVICE` or `appPath: process.env.E2E_APP_PATH`
straight through, with no conditional spread.

## What the engine declares

- **Observation**: the accessibility tree, projected onto the role vocabulary
  (iOS `Button` becomes `button`, `TextField` becomes `textbox`, `Cell` becomes
  `listitem`; Android `android.widget.TextView` becomes `text`, `EditText`
  becomes `textbox`, `Switch` becomes `switch`), with rects, a viewport, and
  pixels on request only when full accessibility captures contain no secure
  controls. Android's native `password` flag marks a secure textbox; its
  ambiguous rendered label, value and descendants are omitted. Element identifiers
  (`ABOUT`, `android:id/title`) surface as the configured test id attribute.
- **Actions**: tap, double tap, long press, fill, clear, check/uncheck (when
  the tree exposes the checked state; Android switches do not), focus on
  editable fields, `Enter`, single-character keys, swipe within a node, drag.
  `selectOption`, `setInputFiles`, focus on a control, and other keys fail
  with `UNSUPPORTED_CAPABILITY`.
- **Location**: every `screen` query, plus agent-device selectors through
  `device.locator('role=NavigationBar id=General')`.
- **Viewport swipe**, `app.back()`, `app.restart()`, `app.clearState()`, and
  screenshots under the attempt artifact directory. Secure screens are withheld:
  separate tree and pixel captures cannot establish atomic masking, even when
  secure rectangles appear stable. Observation remains tree-only; an explicit
  screenshot fails without writing an artifact. Full-tree checks run before
  and after capture even in interactive observation mode. These checks cannot
  detect secrets the application's accessibility implementation does not mark.
  No `state` capability: a
  simulator has no portable session snapshot.

## Trace cache

The runner caches `agent.act` steps by their location anchor, and a device has
no address bar. This engine reports one anyway: `<bundle id> / <screen
title>`, with the title read off the navigation bar on iOS and the collapsing
toolbar on Android. The app identity is part of the location, so two apps with
a "General" screen never share an anchor. A step recorded on
`com.apple.Preferences / General` replays only when that app is on that
screen again, and a flow that stays within tap, type, and scroll replays with
zero model calls. Pin `app` so every attempt starts on the same screen, and
prefer the grammar over the `open_app` tool inside a step: a tool call is a
replay gap.

## The `device` fixture

Deterministic device management, recorded as `device.<method>` steps. Import
`test` from this package to have it typed.

```ts
import { test } from '@e2e-platform/agent-device';
import { expect } from '@e2e-platform/core';

test('shows Android network settings in dark mode', async ({ device, screen }) => {
  await device.setAppearance('dark');
  await expect(screen.getByText('Network & internet')).toBeVisible();
});
```

Save the test as `tests/settings.e2e.ts` and run
`npx --no-install e2e-platform run --no-model`. This starter expects an English
Android Settings home screen; change the locator for your OS image or application.
For the iOS Settings home screen, the corresponding example can assert
`screen.getByText('General', { exact: true })`.

Methods: `setNetwork`, `setAirplaneMode`, `setPermission`, `setLocation`,
`clearLocation`, `setAppearance`, `setOrientation`, `setBiometrics`,
`enrollBiometrics`, `installApp`, `openApp`, `closeApp`, `foregroundApp`,
`home`, `back`, `alert`, `dismissKeyboard`, `clipboard`, `setClipboard`, and
the `locator` accessor.

`installApp(appPath, { app, reinstall })` puts a build on the device from a
test, for upgrade and fresh-install paths the `appPath` option cannot express.
A plain install replaces the binary and keeps its data; `reinstall: true`
removes the app named by `app` (default: the pinned app) first. It resolves to
the bundle id or package to `openApp` the build by.

## Agent tools

`@e2e-platform/agent-device/tools` exports `agentDeviceTools(...engines)`:
`open_app`, `swipe` (free-form, in logical pixels), `type_text` (into the
focused field, for editors that hide it from the tree), `alert`, and
`screenshot` (the model sees the image). Pass every device engine the config
declares: tool names are fixed, so two packs cannot be merged, and the pack
dispatches each call to the engine whose attempt is running. Tools are scoped
to the platforms of those engines, so a suite that mixes web and device
targets can hand the pack to one `createAgent`.

## Secrets

Model-directed secret fills require a secret declared in the step and an
enabled editable target; passwords require a password field. There is no
origin allowlist for device or browser fills. Deterministic `fill(secret)`
uses the field chosen by trusted test code. Both paths register the value
for redaction and withhold pixels for the rest of the attempt. Verify the
device exposes the intended control semantics before supplying credentials.

## Documentation

The complete fork includes [device documentation](../../docs/reference/agent-device.mdx)
and its [security model](../../docs/security.mdx). The upstream website describes
a different distribution.
