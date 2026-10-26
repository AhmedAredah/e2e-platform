import { test as base } from '@e2e-platform/core';
import type { TerminalFixture } from './engine/terminal.ts';
export { TerminalEngine, terminal, type TerminalOptions, type TerminalFixture } from './engine/terminal.ts';
export { TerminalSession } from './model/session.ts';
export { TerminalError, type TerminalErrorCode, type TerminalSessionOptions, type TerminalCommand, type TerminalSnapshot, type TerminalDimensions, type TerminalOperation, type TerminalExit } from './model/types.ts';
export { TerminalTransport, type TerminalTransportFactory } from './transport/base.ts';
export { NodePtyTransport } from './transport/node-pty.ts';
export { encodeKey } from './engine/keys.ts';
/** Same runner, with the terminal fixture typed for this engine. */
export const test = base.extend<{ terminal: TerminalFixture }>();
export const { describe, beforeEach, afterEach, beforeAll, afterAll } = test;
