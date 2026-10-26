import { ConfigurationError, LOCATOR_ACTION_KINDS, type LocatorActionKind } from '@e2e-cpp/core/engine';
import { isRecord } from './transport/json-rpc-tcp.ts';

const DEFAULT_ACTIONS = ['tap', 'fill', 'clear', 'focus', 'press', 'check', 'uncheck', 'selectOption', 'hover'] as const;

/** Declared capabilities are checked against the authenticated helper before an app opens. */
export interface NativeOptions {
  readonly platform?: string;
  readonly actions?: readonly LocatorActionKind[];
  readonly keyboard?: boolean;
  readonly screenshots?: boolean;
  readonly launchTimeout?: number;
  readonly requestTimeout?: number;
  readonly maxMessageBytes?: number;
  /** Process working directory, relative to the e2e project root. */
  readonly cwd?: string;
}

export function validateNativeOptions(options: NativeOptions): readonly LocatorActionKind[] {
  const known = new Set(['platform', 'actions', 'keyboard', 'screenshots', 'launchTimeout', 'requestTimeout', 'maxMessageBytes', 'cwd']);
  if (!isRecord(options)) throw new ConfigurationError('INVALID_CONFIG', 'native options must be an object');
  for (const key of Object.keys(options)) if (!known.has(key)) throw new ConfigurationError('INVALID_CONFIG', `unknown native option ${key}`);
  for (const key of ['keyboard', 'screenshots'] as const) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new ConfigurationError('INVALID_CONFIG', `native.${key} must be boolean`);
  for (const key of ['launchTimeout', 'requestTimeout', 'maxMessageBytes'] as const) {
    const value = options[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2 ** 30)) throw new ConfigurationError('INVALID_CONFIG', `native.${key} must be a positive bounded integer`);
  }
  if (options.cwd !== undefined && typeof options.cwd !== 'string') throw new ConfigurationError('INVALID_CONFIG', 'native.cwd must be a string');
  const actions = options.actions ?? DEFAULT_ACTIONS;
  if (!Array.isArray(actions) || new Set(actions).size !== actions.length || actions.some((kind) => !LOCATOR_ACTION_KINDS.includes(kind))) throw new ConfigurationError('INVALID_CONFIG', 'native.actions must list distinct standard action kinds');
  return actions;
}
