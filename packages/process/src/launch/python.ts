import path from 'node:path';
import { ApplicationLaunchProfile, launchArguments, launchText, type ApplicationCommand, type ApplicationLaunchOptions } from './profile.ts';

export type PythonLaunchOptions = ApplicationLaunchOptions & {
  readonly interpreter: string;
  readonly interpreterArgs?: readonly string[];
} & ({ readonly script: string; readonly module?: never } | { readonly module: string; readonly script?: never });

/** Launches a Python script through an explicitly selected interpreter with unbuffered output. */
export class PythonLaunchProfile extends ApplicationLaunchProfile {
  private readonly interpreter: string;
  private readonly entry: readonly string[];
  private readonly interpreterArgs: readonly string[];
  constructor(options: PythonLaunchOptions) {
    super(options);
    this.interpreter = launchText(options.interpreter, 'interpreter');
    if ((options.script === undefined) === (options.module === undefined)) throw new TypeError('Choose exactly one Python script or module');
    if (options.module !== undefined) {
      const module = launchText(options.module, 'module');
      if (!module.split('.').every(part => /^[\p{ID_Start}_][\p{ID_Continue}_]*$/u.test(part))) throw new TypeError('module must be a dotted Python module name');
      this.entry = ['-m', module];
    } else this.entry = [path.resolve(this.cwd, launchText(options.script, 'script'))];
    this.interpreterArgs = launchArguments(options.interpreterArgs ?? [], 'interpreterArgs');
    if (this.interpreterArgs.some(argument => ['-m', '-c', '--', '-'].includes(argument))) throw new TypeError('interpreterArgs must not replace the Python entrypoint');
  }
  protected override command(): ApplicationCommand { return { executable: this.interpreter, args: [...this.interpreterArgs, '-u', ...this.entry] }; }
}
