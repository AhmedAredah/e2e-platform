import path from 'node:path';
import { ApplicationLaunchProfile, launchText, type ApplicationCommand, type ApplicationLaunchOptions } from './profile.ts';

export interface ExecutableLaunchOptions extends ApplicationLaunchOptions { readonly executable: string; }

/** Launches a compiled executable, including Rust binaries and .NET native apphosts. */
export class ExecutableLaunchProfile extends ApplicationLaunchProfile {
  private readonly executable: string;
  constructor(options: ExecutableLaunchOptions) {
    super(options);
    this.executable = path.resolve(this.cwd, launchText(options.executable, 'executable'));
  }
  protected override command(): ApplicationCommand { return { executable: this.executable, args: [] }; }
}
