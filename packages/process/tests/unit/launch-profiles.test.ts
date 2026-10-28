import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile, PythonLaunchProfile, runProcess } from '../../src/index.ts';

describe('application launch profiles', () => {
  it('supports module launch and refuses ambiguous or replaced entrypoints', () => {
    const profile = new PythonLaunchProfile({ identity: 'module', interpreter: 'python3', module: 'my_app.cli', interpreterArgs: ['-X', 'utf8'] });
    expect(profile.resolve(['serve']).process.args).toEqual(['-X', 'utf8', '-u', '-m', 'my_app.cli', 'serve']);
    for (const entry of [{ script: 'a.py', module: 'a' }, {}, { module: '../a' }, { script: 'a.py', interpreterArgs: ['-m', 'other'] }]) {
      expect(() => new PythonLaunchProfile({ identity: 'invalid', interpreter: 'python3', ...entry } as never)).toThrow(TypeError);
    }
  });
  it('passes spaces and shell metacharacters as literal arguments to a real executable', async () => {
    const values = ['a b', '; echo not-a-command', '$(not-a-command)', ''];
    const profile = new ExecutableLaunchProfile({identity: 'argument-reader', executable: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--']});
    const result = await runProcess({...profile.resolve(values).process, timeoutMs: 5_000});
    expect(JSON.parse(result.stdout.bytes.toString('utf8'))).toEqual(values);
  });
  it('keeps logical identity and build fingerprint separate and preserves literal argument boundaries', () => {
    const args = ['a b', '; echo should-not-run', ''];
    const env = { DEMO: 'one' };
    const profile = new PythonLaunchProfile({identity: 'calculator', buildFingerprint: 'sha256:first', cwd: '/project', interpreter: 'python3', script: 'demo app.py', args, env});
    args.push('later'); env.DEMO = 'two';
    const launch = profile.resolve(['$(not-a-shell)']);
    expect(launch.identity).toBe('calculator');
    expect(launch.buildFingerprint).toBe('sha256:first');
    expect(launch.process).toEqual({executable: 'python3', args: ['-u', path.resolve('/project', 'demo app.py'), 'a b', '; echo should-not-run', '', '$(not-a-shell)'], cwd: path.resolve('/project'), env: {DEMO: 'one'}, inheritEnv: false});
    expect(Object.isFrozen(launch.process.args)).toBe(true);
  });
  it('launches built assemblies and native binaries without build wrappers', () => {
    const dotnet = new DotnetLaunchProfile({identity: 'app', cwd: '/project', dotnet: 'dotnet', assembly: 'out/app.dll'}).resolve(['serve']);
    expect(dotnet.process.args).toEqual([path.resolve('/project', 'out/app.dll'), 'serve']);
    const rust = new ExecutableLaunchProfile({identity: 'app', cwd: '/project', executable: 'out/app', inheritEnv: true}).resolve();
    expect(rust.process.executable).toBe(path.resolve('/project', 'out/app'));
    expect(rust.process.inheritEnv).toBe(true);
  });
  it('supports another runtime through the abstract command boundary', () => {
    class CustomProfile extends ApplicationLaunchProfile {
      constructor() {super({identity: 'custom'});}
      protected override command() {return {executable: 'custom-runtime', args: ['entry']};}
    }
    expect(new CustomProfile().resolve(['one']).process.args).toEqual(['entry', 'one']);
  });
  it.each([
    {identity: ''}, {identity: 'x\0y'}, {cwd: ''}, {args: [1]}, {args: ['x\0']},
    {env: {'BAD=KEY': 'value'}}, {env: {BAD: 'x\0'}}, {buildFingerprint: ''}, {inheritEnv: 1},
  ])('rejects malformed launch options %j', (override) => {
    expect(() => new ExecutableLaunchProfile({identity: 'app', executable: 'app', ...override} as never)).toThrow(TypeError);
  });
});
