import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { TerminalError } from '../model/types.ts';

const require = createRequire(import.meta.url);
const SETUP_COMMAND = 'npx --no-install e2e-platform-terminal-setup';

/** Checks the helper used by the loaded macOS peer; repairs require an explicit CLI call. */
export class NodePtyInstallation {
  readonly #root: string;
  readonly #helper: string;
  readonly #version: string;

  constructor(packageRoot: string, nativeModule: string) {
    this.#root = fs.realpathSync(packageRoot);
    this.#helper = join(dirname(nativeModule), 'spawn-helper');
    try {
      const manifest = JSON.parse(fs.readFileSync(join(this.#root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
      if (manifest.name !== 'node-pty' || typeof manifest.version !== 'string') throw new Error('Invalid node-pty package metadata');
      this.#version = manifest.version;
    } catch (cause) {
      throw new TerminalError('DEPENDENCY_MISSING', 'Cannot inspect node-pty package metadata; reinstall the optional peer', { cause });
    }
  }

  static loaded(): NodePtyInstallation | undefined {
    if (process.platform !== 'darwin') return undefined;
    try {
      const manifestPath = require.resolve('node-pty/package.json');
      const root = fs.realpathSync(dirname(manifestPath));
      // Match the module that actually loaded, not merely the first file that
      // exists: node-pty can skip an incompatible Release or Debug build.
      const nativeModule = ['build/Release', 'build/Debug', `prebuilds/darwin-${process.arch}`]
        .map((directory) => join(root, directory, 'pty.node'))
        .find((file) => require.cache[file] !== undefined);
      if (nativeModule === undefined) throw new Error('Cannot identify the loaded node-pty native module');
      return new NodePtyInstallation(root, nativeModule);
    } catch (cause) {
      throw new TerminalError('DEPENDENCY_MISSING', 'Cannot inspect the installed macOS node-pty helper; reinstall the peer in a standard Node.js project', { cause });
    }
  }

  /** Read-only preflight: launching a terminal never changes installed files. */
  assertReady(): void {
    try {
      const stats = this.#helperStats();
      if ((stats.mode & 0o111) === 0) throw new Error('spawn-helper has no executable permission');
      fs.accessSync(this.#helper, fs.constants.X_OK);
    } catch (cause) {
      throw this.#unavailable(cause);
    }
  }

  /** Repairs only the known 1.1.0 packaging defect, without modifying shared inodes. */
  repair(): boolean {
    let temporary: string | undefined;
    let descriptor: number | undefined;
    try {
      const before = this.#helperStats();
      if ((before.mode & 0o111) !== 0) { this.assertReady(); return false; }
      if (this.#version !== '1.1.0') throw new Error(`Automatic setup does not modify node-pty ${this.#version}; rebuild or reinstall that version`);
      descriptor = fs.openSync(this.#helper, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('spawn-helper changed during setup');
      // Grant execute only to identities that could already read these bytes.
      const executableMode = (opened.mode & 0o777) | ((opened.mode & 0o444) >> 2);
      if ((executableMode & 0o111) === 0) throw new Error('spawn-helper has no readable permission to preserve');
      const bytes = fs.readFileSync(descriptor);
      temporary = join(dirname(this.#helper), `.spawn-helper-${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: executableMode });
      fs.chmodSync(temporary, executableMode);
      const current = this.#helperStats();
      if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('spawn-helper changed during setup');
      fs.renameSync(temporary, this.#helper);
      temporary = undefined;
      this.assertReady();
      return true;
    } catch (cause) {
      throw this.#unavailable(cause);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (temporary !== undefined) fs.rmSync(temporary, { force: true });
    }
  }

  #helperStats(): fs.Stats {
    const parent = fs.realpathSync(dirname(this.#helper));
    const local = relative(this.#root, parent);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('spawn-helper is outside its installed package');
    const stats = fs.lstatSync(this.#helper);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('spawn-helper must be a regular file, not a symlink');
    return stats;
  }

  #unavailable(cause: unknown): TerminalError {
    return new TerminalError('DEPENDENCY_MISSING', `The macOS node-pty spawn-helper is missing, unsafe or not executable. Run ${SETUP_COMMAND} after installing node-pty; if the package directory is read-only, reinstall it in a writable project. Helper: ${this.#helper}`, { cause });
  }
}
