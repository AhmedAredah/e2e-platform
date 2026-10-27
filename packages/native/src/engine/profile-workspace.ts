import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** A fresh profile for applications that honor these directories or the explicit profile variable. */
export class NativeProfileWorkspace {
  private disposed = false;
  private constructor(readonly directory: string, readonly env: Readonly<Record<string, string>>) {}

  static async create(): Promise<NativeProfileWorkspace> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'e2e-native-profile-'));
    try {
      const directories = Object.fromEntries(['config', 'data', 'cache', 'roaming', 'local'].map((kind) => [kind, path.join(directory, kind)]));
      await Promise.all(Object.values(directories).map((entry) => mkdir(entry, { mode: 0o700 })));
      return new NativeProfileWorkspace(directory, Object.freeze({
        E2E_NATIVE_PROFILE_DIR: directory,
        XDG_CONFIG_HOME: directories.config!, XDG_DATA_HOME: directories.data!, XDG_CACHE_HOME: directories.cache!,
        APPDATA: directories.roaming!, LOCALAPPDATA: directories.local!,
      }));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await rm(this.directory, { recursive: true, force: true });
    this.disposed = true;
  }
}
