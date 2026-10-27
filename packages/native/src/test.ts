import { test as base } from '@e2e-platform/core';
import type { NativeApp } from './fixtures/native-app.ts';

export { expect } from '@e2e-platform/core';
export type { NativeApp } from './fixtures/native-app.ts';

/** Typed access to the native fixture supplied by native(), qt() or desktop(). */
export const test = base.extend<{ native: NativeApp }>();
