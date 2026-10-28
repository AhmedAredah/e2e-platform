import { ApplicationLaunchProfile, ExecutableLaunchProfile, PythonLaunchProfile, type ApplicationCommand, type ApplicationLaunch } from '../../src/index.ts';
class CustomRuntime extends ApplicationLaunchProfile {
  constructor() {super({identity: 'custom.runtime'});}
  protected override command(): ApplicationCommand {return {executable: 'runtime', args: []};}
}
const launch: ApplicationLaunch = new CustomRuntime().resolve(['literal argument']);
void launch;
// @ts-expect-error A logical identity is required.
void new ExecutableLaunchProfile({executable: 'app'});
// @ts-expect-error No shell mode is offered.
void new ExecutableLaunchProfile({identity: 'app', executable: 'app', shell: true});
// @ts-expect-error Interpreter and entry point are explicit.
void new PythonLaunchProfile({identity: 'python', script: 'app.py'});
// @ts-expect-error Argument arrays are readonly strings.
new CustomRuntime().resolve([1]);
// @ts-expect-error Script and module entrypoints are mutually exclusive.
void new PythonLaunchProfile({identity: 'python', interpreter: 'python3', script: 'app.py', module: 'app'});
