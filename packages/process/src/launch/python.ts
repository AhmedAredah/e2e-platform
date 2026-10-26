import path from 'node:path';
import { ApplicationLaunchProfile, launchArguments, launchText, type ApplicationCommand, type ApplicationLaunchOptions } from './profile.ts';

export interface PythonLaunchOptions extends ApplicationLaunchOptions {
  readonly interpreter: string;
  readonly script: string;
  readonly interpreterArgs?: readonly string[];
}

/** Launches a Python script through an explicitly selected interpreter with unbuffered output. */
export class PythonLaunchProfile extends ApplicationLaunchProfile {
  private readonly interpreter: string;
  private readonly script: string;
  private readonly interpreterArgs: readonly string[];
  constructor(options: PythonLaunchOptions) {
    super(options);
    this.interpreter = launchText(options.interpreter, 'interpreter');
    this.script = path.resolve(this.cwd, launchText(options.script, 'script'));
    this.interpreterArgs = launchArguments(options.interpreterArgs ?? [], 'interpreterArgs');
  }
  protected override command(): ApplicationCommand { return { executable: this.interpreter, args: [...this.interpreterArgs, '-u', this.script] }; }
}
