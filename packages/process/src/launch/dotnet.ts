import path from 'node:path';
import { ApplicationLaunchProfile, launchText, type ApplicationCommand, type ApplicationLaunchOptions } from './profile.ts';

export interface DotnetLaunchOptions extends ApplicationLaunchOptions { readonly dotnet: string; readonly assembly: string; }

/** Launches a built .NET assembly; compilation is kept outside the measured application run. */
export class DotnetLaunchProfile extends ApplicationLaunchProfile {
  private readonly dotnet: string;
  private readonly assembly: string;
  constructor(options: DotnetLaunchOptions) {
    super(options);
    this.dotnet = launchText(options.dotnet, 'dotnet');
    this.assembly = path.resolve(this.cwd, launchText(options.assembly, 'assembly'));
  }
  protected override command(): ApplicationCommand { return { executable: this.dotnet, args: [this.assembly] }; }
}
