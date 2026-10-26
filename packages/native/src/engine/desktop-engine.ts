import path from 'node:path';
import { ConfigurationError, type EngineInitInfo, type LocatorActionKind } from '@e2e-platform/core/engine';
import type { ProcessSession } from '@e2e-platform/process';
import { NativeEngine } from './native-engine.ts';
import type { NativeProcessLaunch } from './native-process.ts';
import { isRecord } from '../transport/json-rpc-tcp.ts';
import { validateNativeOptions, type NativeOptions } from '../options.ts';

/** Accessibility provider used by an owned desktop driver process. */
export type DesktopBackend = 'linux-atspi' | 'windows-uia' | 'macos-ax';

/** Driver command and bounded native-engine options. Driver arguments precede `-- app argv`. */
export interface DesktopOptions {
  readonly backend: DesktopBackend;
  /** Absolute executable, relative executable path, or command found in the supplied PATH. */
  readonly executable: string;
  /** Literal driver arguments, such as a Python entry point or .NET assembly path. */
  readonly args?: readonly string[];
  /** Optional subset of this backend's actions. Unsupported per-control patterns still fail explicitly. */
  readonly actions?: readonly LocatorActionKind[];
  readonly launchTimeout?: number;
  readonly requestTimeout?: number;
  readonly maxMessageBytes?: number;
  /** Driver/application working directory, relative to the e2e project root. */
  readonly cwd?: string;
}

const COMMON_ACTIONS = ['tap', 'fill', 'clear', 'focus', 'check', 'uncheck'] as const;
const BACKENDS: Readonly<Record<DesktopBackend, { platform: NodeJS.Platform; actions: readonly LocatorActionKind[] }>> = {
  'linux-atspi': { platform: 'linux', actions: [...COMMON_ACTIONS, 'selectOption'] },
  'windows-uia': { platform: 'win32', actions: [...COMMON_ACTIONS, 'selectOption'] },
  'macos-ax': { platform: 'darwin', actions: COMMON_ACTIONS },
};

/**
 * Adapts an owned OS accessibility sidecar to the existing native lifecycle.
 * The sidecar owns its target application; the runner never attaches to unrelated processes.
 */
export class DesktopEngine extends NativeEngine {
  private readonly desktopOptions: Readonly<DesktopOptions>;

  constructor(options: DesktopOptions) {
    const validated = validateDesktopOptions(options);
    super(validated.native);
    this.desktopOptions = validated.desktop;
  }

  /** Refuse a mismatched platform before any driver or application is started. */
  override async init(info: EngineInitInfo): Promise<void> {
    const backend = this.desktopOptions.backend;
    if (process.platform !== BACKENDS[backend].platform) {
      throw new ConfigurationError('INVALID_CONFIG', `desktop backend ${backend} requires ${BACKENDS[backend].platform}; this host is ${process.platform}`);
    }
    await super.init(info);
  }

  /** Pass application argv without a shell while retaining the base engine's process ownership. */
  protected override createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
    const command = this.desktopOptions.executable;
    const executable = command.includes('/') || command.includes('\\')
      ? path.resolve(launch.options.cwd ?? process.cwd(), command)
      : command;
    return super.createProcess({
      ...launch,
      options: {
        ...launch.options,
        executable,
        // Native sidecars may need to terminate/reap a separately owned application.
        killGraceMs: 1000,
        args: [...(this.desktopOptions.args ?? []), '--', launch.options.executable, ...(launch.options.args ?? [])],
      },
    });
  }
}

/** Validate before selecting capabilities so malformed runtime JavaScript fails closed. */
function validateDesktopOptions(options: DesktopOptions): { desktop: Readonly<DesktopOptions>; native: NativeOptions } {
  if (!isRecord(options)) throw new ConfigurationError('INVALID_CONFIG', 'desktop options must be an object');
  const known = new Set(['backend', 'executable', 'args', 'actions', 'launchTimeout', 'requestTimeout', 'maxMessageBytes', 'cwd']);
  for (const key of Object.keys(options)) if (!known.has(key)) throw new ConfigurationError('INVALID_CONFIG', `unknown desktop option ${key}`);
  if (typeof options.backend !== 'string' || !Object.hasOwn(BACKENDS, options.backend)) throw new ConfigurationError('INVALID_CONFIG', 'desktop.backend must be linux-atspi, windows-uia or macos-ax');
  if (typeof options.executable !== 'string' || options.executable.trim() === '' || options.executable.includes('\0')) throw new ConfigurationError('INVALID_CONFIG', 'desktop.executable must be a nonempty command without NUL characters');
  if (options.args !== undefined && (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')))) throw new ConfigurationError('INVALID_CONFIG', 'desktop.args must contain literal strings without NUL characters');
  if (options.args?.includes('--')) throw new ConfigurationError('INVALID_CONFIG', 'desktop.args must not contain the reserved application separator --');
  const available = BACKENDS[options.backend].actions;
  const native: NativeOptions = {
    platform: options.backend,
    actions: options.actions ?? available,
    keyboard: false,
    screenshots: false,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.launchTimeout === undefined ? {} : { launchTimeout: options.launchTimeout }),
    ...(options.requestTimeout === undefined ? {} : { requestTimeout: options.requestTimeout }),
    ...(options.maxMessageBytes === undefined ? {} : { maxMessageBytes: options.maxMessageBytes }),
  };
  const actions = validateNativeOptions(native);
  if (actions.length === 0) throw new ConfigurationError('INVALID_CONFIG', 'desktop.actions must contain at least one action');
  if (actions.some((kind) => !available.includes(kind))) throw new ConfigurationError('INVALID_CONFIG', `desktop.actions contains an action unsupported by ${options.backend}`);
  return {
    native,
    desktop: Object.freeze({ ...options, args: Object.freeze([...(options.args ?? [])]), actions: Object.freeze([...actions]) }),
  };
}
