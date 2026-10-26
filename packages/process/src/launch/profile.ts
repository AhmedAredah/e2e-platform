import path from 'node:path';
import type { ProcessOptions } from '../types.ts';

/** Application identity is logical; a build fingerprint identifies particular tested bytes. */
export interface ApplicationLaunchOptions {
  readonly identity: string;
  readonly buildFingerprint?: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Defaults to false: runtime environment must be supplied deliberately. */
  readonly inheritEnv?: boolean;
}

/** A direct command, with arguments passed literally to the process supervisor. */
export interface ApplicationCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

/** Metadata stays separate from ProcessOptions and does not silently change runner cache keys. */
export interface ApplicationLaunch {
  readonly identity: string;
  readonly buildFingerprint?: string;
  readonly process: ProcessOptions;
}

/** Rejects empty identifiers/paths and NUL while preserving legitimate spaces. */
export function launchText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) throw new TypeError(`${label} must be a non-empty string without NUL`);
  return value;
}

/** Copies literal argument arrays before a caller can mutate them. */
export function launchArguments(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) throw new TypeError(`${label} must be an array of strings without NUL`);
  return Object.freeze([...value]);
}

/** Resolves a runtime-specific command without building it or invoking a shell. */
export abstract class ApplicationLaunchProfile {
  readonly identity: string;
  readonly buildFingerprint: string | undefined;
  protected readonly cwd: string;
  private readonly args: readonly string[];
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly inheritEnv: boolean;

  protected constructor(options: ApplicationLaunchOptions) {
    this.identity = launchText(options.identity, 'identity');
    this.buildFingerprint = options.buildFingerprint === undefined ? undefined : launchText(options.buildFingerprint, 'buildFingerprint');
    this.cwd = path.resolve(launchText(options.cwd ?? process.cwd(), 'cwd'));
    this.args = launchArguments(options.args ?? [], 'args');
    if (options.inheritEnv !== undefined && typeof options.inheritEnv !== 'boolean') throw new TypeError('inheritEnv must be a boolean');
    if (options.env !== undefined && (typeof options.env !== 'object' || options.env === null || Array.isArray(options.env))) throw new TypeError('env must be an object');
    const entries = Object.entries(options.env ?? {});
    for (const [name, value] of entries) {
      if (name === '' || name.includes('=') || name.includes('\0')) throw new TypeError('env names must be non-empty and contain neither = nor NUL');
      if (value !== undefined && (typeof value !== 'string' || value.includes('\0'))) throw new TypeError(`env.${name} must be a string without NUL or undefined`);
    }
    this.env = Object.freeze(Object.fromEntries(entries));
    this.inheritEnv = options.inheritEnv ?? false;
  }

  /** Subclasses supply the runtime and entry point before application arguments. */
  protected abstract command(): ApplicationCommand;

  /** Produces an immutable launch plan; timeout, signal and capture policy remain supervisor options. */
  resolve(additionalArgs: readonly string[] = []): ApplicationLaunch {
    const command = this.command();
    const executable = launchText(command.executable, 'executable');
    const args = Object.freeze([...launchArguments(command.args, 'command.args'), ...this.args, ...launchArguments(additionalArgs, 'additionalArgs')]);
    return Object.freeze({
      identity: this.identity,
      ...(this.buildFingerprint === undefined ? {} : { buildFingerprint: this.buildFingerprint }),
      process: Object.freeze({ executable, args, cwd: this.cwd, env: this.env, inheritEnv: this.inheritEnv }),
    });
  }
}
