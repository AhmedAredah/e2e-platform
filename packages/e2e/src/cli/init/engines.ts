/** CLI scaffold presets. Engine packages are referenced as generated source, never imported. */

import os from 'node:os';
import { playwrightRange, siblingDependency, SIBLING_VERSIONS } from './versions.ts';

export interface EnginePreset {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly imports: readonly string[];
  readonly config: string;
  readonly example: string;
  readonly aiExample?: string;
  /** Whether the run hint sets APP_URL, for engines that drive a URL. */
  readonly needsAppUrl: boolean;
}

/** Builds prompt choices and scaffolds with defaults for the machine running init. */
export function getEnginePresets() {
  const ios = os.platform() === 'darwin';
  const desktopBackend = ios ? 'macos-ax' : os.platform() === 'win32' ? 'windows-uia' : 'linux-atspi';
  return [
    {
      id: 'cli',
      label: 'CLI application',
      hint: 'deterministic process tests; no model required',
      dependencies: siblingDependency('@e2e-platform/process'),
      imports: [],
      config: `  modelPolicy: 'forbid',
  targets: [{ name: 'cli', platform: 'process' }],`,
      example: `import { test, expect } from '@e2e-platform/process/test';

test('CLI prints its version', async ({ processes }) => {
  // Replace this Node executable with your application's executable or runtime.
  const result = await processes.run({
    executable: process.execPath,
    args: ['--version'],
    timeoutMs: 5000,
  });
  expect(result.stdout.bytes.toString('utf8')).toMatch(/^v[0-9]+\\./);
});
`,
      needsAppUrl: false,
    },
    {
      id: 'qt',
      label: 'Qt desktop',
      hint: 'application linked with E2E::QtBridge',
      dependencies: siblingDependency('@e2e-platform/native'),
      imports: ["import { qt } from '@e2e-platform/native';"],
      config: `  targets: [{
    name: 'qt',
    engine: qt(),
    // Build your application with the native/qt helper before running.
    app: { appPath: process.env.APP_PATH ?? './build/my-app', launchArguments: [] },
  }],
  workers: 1,`,
      example: `import { test, expect } from '@e2e-platform/core';

test('desktop control is accessible', async ({ app, screen }) => {
  await app.open();
  // Set this objectName on a visible control in your application.
  await expect(screen.getByTestId('main-control')).toBeVisible();
});
`,
      needsAppUrl: false,
    },
    {
      id: 'desktop',
      label: 'Desktop accessibility',
      hint: 'OS accessibility sidecar; build and permission setup required',
      dependencies: siblingDependency('@e2e-platform/native'),
      imports: ["import { desktop } from '@e2e-platform/native';"],
      config: `  targets: [{
    name: 'desktop',
    engine: desktop({
      backend: '${desktopBackend}',
      // Build/install the matching native driver and provide its executable.
      executable: process.env.E2E_DRIVER ?? '/absolute/path/to/desktop-driver',
      args: [], // Runtime prefix arguments, if your driver needs them.
    }),
    app: { appPath: process.env.APP_PATH ?? './build/my-app', launchArguments: [] },
  }],
  workers: 1,`,
      example: `import { test, expect } from '@e2e-platform/core';

test('desktop control is accessible', async ({ app, screen }) => {
  await app.open();
  // Use a control's real accessibility role and name.
  await expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
});
`,
      needsAppUrl: false,
    },
    {
      id: 'playwright',
      label: 'Web',
      hint: 'Playwright',
      dependencies: { ...siblingDependency('@e2e-platform/playwright'), playwright: playwrightRange(SIBLING_VERSIONS?.['playwright']) },
      imports: ["import { playwright } from '@e2e-platform/playwright';"],
      config: `  targets: [{
    engine: playwright({
      url: process.env.APP_URL ?? 'http://localhost:3000',
      // Or let the runner start the dev server:
      // command: { executable: 'npm', args: ['run', 'dev'] },
    }),
  }],`,
      example: `import { test } from '@e2e-platform/playwright';
import { expect } from '@e2e-platform/core';

test('app opens', async ({ app, web }) => {
  await app.open('/');
  await expect(web.locator('body')).toBeVisible();
});
`,
      aiExample: `
// With the model key in the environment, uncomment:
// test('the agent drives a flow', async ({ app, agent }) => {
//   await app.open('/');
//   await agent.act('one goal in natural language');
//   await agent.assert('one question about the screen');
// });
`,
      needsAppUrl: true,
    },
    {
      id: 'agent-device',
      label: 'Mobile (iOS/Android)',
      hint: 'agent-device',
      dependencies: siblingDependency('@e2e-platform/agent-device'),
      imports: ["import { agentDevice } from '@e2e-platform/agent-device';"],
      config: ios
        ? `  // Replace Settings with your app's bundle id.
  targets: [{ name: 'ios', engine: agentDevice({ platform: 'ios', app: 'Settings' }) }],
  workers: 1,`
        : `  // Replace com.android.settings with your app's package name.
  targets: [{ name: 'android', engine: agentDevice({ platform: 'android', app: 'com.android.settings' }) }],
  workers: 1,`,
      example: `import { test } from '@e2e-platform/agent-device';
import { expect } from '@e2e-platform/core';

test('Settings opens', async ({ screen }) => {
  await expect(${ios ? "screen.getByRole('button', { name: 'General' })" : "screen.getByText('Network & internet')"}).toBeVisible();
});
`,
      aiExample: ios
        ? `
// With the model key in the environment, uncomment:
// test('the agent opens General', async ({ agent, device }) => {
//   await agent.act('open General settings');
//   await expect(device.locator('role=NavigationBar id=General')).toBeVisible();
// });
`
        : `
// With the model key in the environment, uncomment:
// test('the agent opens Network settings', async ({ agent, device }) => {
//   await agent.act('open Network & internet settings');
//   await expect(device.locator('id=com.android.settings:id/collapsing_toolbar')).toHaveText('Network & internet');
// });
`,
      needsAppUrl: false,
    },
    {
      id: 'none',
      label: 'None',
      hint: 'HTTP tests or your own engine',
      dependencies: {},
      imports: [],
      config: `  // Add an engine here when your tests need to drive an app.
  targets: [{ name: 'default', platform: 'custom' }],`,
      example: `import { test, expect } from '@e2e-platform/core';

test('app responds', async () => {
  const response = await fetch(process.env.APP_URL ?? 'http://localhost:3000');
  expect(response.ok).toBe(true);
});
`,
      needsAppUrl: true,
    },
  ] as const satisfies readonly EnginePreset[];
}

export type EngineId = ReturnType<typeof getEnginePresets>[number]['id'];
export const DEFAULT_ENGINE_ID = 'cli' satisfies EngineId;

/** Resolves a preset with the common shape used by scaffold generation. */
export function getEnginePreset(id: EngineId): EnginePreset {
  const preset = getEnginePresets().find((entry) => entry.id === id);
  if (preset === undefined) throw new Error(`unknown engine: ${id}`);
  return preset;
}
