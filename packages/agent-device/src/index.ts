/**
 * `@e2e-platform/agent-device` public surface: the `agentDevice()` engine factory,
 * the `device` fixture types, and a `test` typed with that fixture. `expect`
 * and `credentials` still come from `@e2e-platform/core`; the agent-side tool pack lives on
 * the `@e2e-platform/agent-device/tools` subpath so this entry never loads the AI SDK.
 */

import { test as base } from '@e2e-platform/core';
import type { Device } from './device.ts';

export { agentDevice } from './engine.ts';
export type { AgentDeviceOptions, AgentDevicePlatform } from './options.ts';
export type { InstallAppOptions, InstalledApp } from './surface.ts';
export type { BiometricSensor, Device, DeviceOrientation, DevicePermission, ForegroundApp } from './device.ts';

/**
 * `test` typed with this engine's contributed `device` fixture. The same
 * runtime `test` as `@e2e-platform/core`'s; only the fixture types differ.
 */
export const test = base.extend<{ device: Device }>();
