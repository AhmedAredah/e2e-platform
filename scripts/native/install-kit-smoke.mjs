import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPackageManager } from './package-manager.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cliArgs = process.argv.slice(2);
if (cliArgs.length !== 0 && (cliArgs.length !== 2 || cliArgs[0] !== '--kit')) throw new Error('Usage: node scripts/native/install-kit-smoke.mjs [--kit directory]');
const sourceKit = cliArgs.length === 0 ? undefined : resolve(cliArgs[1]);
const directory = mkdtempSync(join(tmpdir(), 'e2e kit with spaces & '));
const kit = join(directory, 'package kit & files');
const project = join(directory, 'consumer project & tests');
const env = { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
let executableDirectory;

/** Checks the real command outcome and prints its captured diagnostics on failure. */
function requireSuccess(label, result) {
  if (result.status !== 0) throw new Error(`${label} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  process.stdout.write(`${label}: passed\n`);
}

/** Runs an actual Node entry without a command shell. */
function node(label, args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  requireSuccess(label, result);
  return result;
}

try {
  mkdirSync(join(project, 'tests'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'platform-kit-consumer', private: true, type: 'module' }));
  if (sourceKit === undefined) node('Pack kit into a path with spaces and ampersands', [join(root, 'scripts/native/pack.mjs'), kit]);
  else cpSync(sourceKit, kit, { recursive: true, errorOnExist: true });
  node('Install through the shipped installer', [join(kit, 'install.mjs'), project]);
  requireSuccess('Reinstall the npm lockfile', runPackageManager('npm', ['ci', '--no-audit', '--no-fund'], { cwd: project, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));
  const manifest = JSON.parse(readFileSync(join(kit, 'manifest.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(project, 'package-lock.json'), 'utf8'));
  if (Object.keys(lock.packages).some((name) => /(?:^|\/)node_modules\/(?:e2e|@e2edev\/[^/]+|@e2e-dev\/[^/]+)$/.test(name))) {
    throw new Error('The fork kit unexpectedly resolved an upstream e2e package');
  }
  for (const { name, version } of manifest.packages) {
    const installed = join(project, 'node_modules', name);
    const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    if (metadata.name !== name || metadata.version !== version || metadata.license !== 'MIT') throw new Error(`Invalid installed metadata for ${name}`);
    if (metadata.repository?.url !== 'git+https://github.com/AhmedAredah/e2e-platform.git'
      && metadata.repository?.url !== 'https://github.com/AhmedAredah/e2e-platform.git') throw new Error(`Invalid installed repository attribution for ${name}`);
    if (metadata.bugs?.url !== 'https://github.com/AhmedAredah/e2e-platform/issues') throw new Error(`Invalid installed support URL for ${name}`);
    if (!existsSync(join(installed, 'LICENSE')) || !readFileSync(join(installed, 'LICENSE'), 'utf8').includes('Permission is hereby granted')) throw new Error(`Missing MIT license for ${name}`);
    if (!existsSync(join(installed, 'NOTICE')) || readFileSync(join(installed, 'NOTICE'), 'utf8').trim().length === 0) throw new Error(`Missing third-party notice for ${name}`);
  }
  const nativeSchemaDirectory = join(project, 'node_modules/@e2e-platform/native/schema');
  for (const file of ['README.md', 'native-bridge-1.schema.json', 'fixtures/native-bridge-1.conformance.json']) {
    if (!existsSync(join(nativeSchemaDirectory, file))) throw new Error(`Installed native protocol file is missing: ${file}`);
  }
  const nativeSchema = JSON.parse(readFileSync(join(nativeSchemaDirectory, 'native-bridge-1.schema.json'), 'utf8'));
  const nativeFixtures = JSON.parse(readFileSync(join(nativeSchemaDirectory, 'fixtures/native-bridge-1.conformance.json'), 'utf8'));
  const initializeRequest = nativeSchema.$defs?.request?.oneOf?.find((frame) => frame.properties?.method?.const === 'initialize');
  if (nativeSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || nativeSchema.$id !== 'urn:e2e-platform:native-bridge:1' || nativeSchema.$defs?.initialization?.properties?.protocolVersion?.const !== 1 || initializeRequest?.properties?.params?.properties?.protocolVersion?.const !== 1) throw new Error('Installed native schema does not describe protocol version 1');
  if (!Array.isArray(nativeFixtures) || !nativeFixtures.some((fixture) => fixture.valid === false) || !nativeFixtures.some((fixture) => fixture.valid === true && fixture.value?.method === 'initialize' && fixture.value.params?.protocolVersion === 1) || !nativeFixtures.some((fixture) => fixture.valid === true && fixture.value?.result?.protocolVersion === 1)) throw new Error('Installed native conformance fixtures do not contain the protocol-v1 request/response and negative cases');
  process.stdout.write('Installed native protocol-v1 schema and conformance fixtures: passed\n');
  const terminalDirectory = join(project, 'node_modules/@e2e-platform/terminal');
  const terminalMetadata = JSON.parse(readFileSync(join(terminalDirectory, 'package.json'), 'utf8'));
  const setupEntry = terminalMetadata.bin?.['e2e-platform-terminal-setup'];
  if (typeof setupEntry !== 'string' || setupEntry.replace(/^\.\//, '') !== 'dist/cli/setup.js') throw new Error('Installed terminal setup executable metadata is missing or unexpected');
  const setupHelp = node('Read the installed terminal setup command help', [join(terminalDirectory, setupEntry), '--help'], project);
  if (!setupHelp.stdout.includes('Usage: e2e-platform-terminal-setup')) throw new Error('Installed terminal setup help has the wrong identity');
  const audit = runPackageManager('npm', ['audit', '--json'], { cwd: project, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  const evidence = join(root, '.e2e', 'cpp');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'install-kit-audit.json'), audit.stdout ?? '');
  writeFileSync(join(evidence, 'installed-consumer-package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(join(evidence, 'installed-consumer-package.json'), readFileSync(join(project, 'package.json')));
  writeFileSync(join(evidence, 'installed-kit-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  requireSuccess('Audit the installed tool dependencies', audit);
  const auditReport = JSON.parse(audit.stdout);
  if (auditReport.metadata?.vulnerabilities?.total !== 0) throw new Error('Installed kit audit did not report zero vulnerabilities');
  writeFileSync(join(project, 'imports.mjs'), manifest.packages.map(({ name }) => `await import(${JSON.stringify(name)});`).join('\n') + `
import { ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile } from '@e2e-platform/process';
import { NativeEngine, DesktopEngine, desktop } from '@e2e-platform/native';
for (const constructor of [ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile, NativeEngine, DesktopEngine, desktop]) {
  if (typeof constructor !== 'function') throw new Error('An installed extension constructor is missing');
}
for (const constructor of [PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile]) {
  if (!(constructor.prototype instanceof ApplicationLaunchProfile)) throw new Error('Installed language profiles do not extend their public base class');
}
`);
  node('Import all installed packages in plain Node', [join(project, 'imports.mjs')], project);
  const installedCli = join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js');
  node('Initialize an installed CLI project with default options', [installedCli, 'init', '--yes'], project);
  node('Run the generated deterministic CLI example', [installedCli, 'run', '--no-model', '--workers', '1'], project);
  const initialized = JSON.parse(readFileSync(join(project, '.e2e/report.json'), 'utf8')).run;
  if (initialized.status !== 'passed' || initialized.errors?.length || initialized.results.filter((result) => result.kind === 'test' && result.status === 'passed').length !== 1) throw new Error('Default installed initializer did not produce its one passing CLI test');
  writeFileSync(join(evidence, 'installed-default-init-report.json'), readFileSync(join(project, '.e2e/report.json')));
  rmSync(join(project, 'tests/example.e2e.ts'));
  rmSync(join(project, 'e2e.config.ts'));

  writeFileSync(join(project, 'e2e.config.ts'), "export default { retries: 0, modelPolicy: 'forbid', targets: [{ name: 'local', platform: 'test' }] };\n");
  writeFileSync(join(project, 'tests/installed.e2e.ts'), `import { test, expect } from '@e2e-platform/process/test';
test('installed process fixture owns a real child', async ({ processes }) => {
  const child = await processes.run({ executable: process.execPath, args: ['-e', 'process.stdout.write("installed kit")'], timeoutMs: 5000 });
  expect(child.stdout.bytes.toString()).toBe('installed kit');
});\n`);
  node('Run a TypeScript test through the installed CLI', [join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js'), 'run', '--no-model', '--workers', '1'], project);
  const help = node('Read installed CLI help from a path containing spaces and ampersands', [installedCli, '--help'], project);
  if (!help.stdout.includes('e2e-platform')) throw new Error('Installed help does not identify the fork executable');
  const positiveDocument = readFileSync(join(project, '.e2e/report.json'), 'utf8');
  writeFileSync(join(evidence, 'installed-consumer-positive.json'), positiveDocument);
  const report = JSON.parse(positiveDocument).run;
  const passed = report.results[0];
  if (report.status !== 'passed' || report.errors?.length || report.results.length !== 1 || passed?.kind !== 'test' || passed.status !== 'passed' || passed.attempts.length !== 1 || passed.attempts[0]?.cleanup !== 'complete' || passed.attempts[0]?.error || passed.attempts[0]?.secondaryErrors?.length) throw new Error('Installed CLI did not record its intended passing test with complete cleanup');
  writeFileSync(join(project, 'tests/negative.e2e.ts'), `import { test, expect } from '@e2e-platform/process/test';
test('rejects wrong output from an installed process fixture', async ({ processes }) => {
  const child = await processes.run({ executable: process.execPath, args: ['-e', 'process.stdout.write("wrong")'], timeoutMs: 5000 });
  expect(child.stdout.bytes.toString()).toBe('expected');
});\n`);
  const negative = spawnSync(process.execPath, [join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js'), 'run', 'tests/negative.e2e.ts', '--no-model', '--workers', '1'], { cwd: project, env, encoding: 'utf8', timeout: 180_000 });
  const rejectedDocument = readFileSync(join(project, '.e2e/report.json'), 'utf8');
  writeFileSync(join(evidence, 'installed-consumer-negative.json'), rejectedDocument);
  const rejected = JSON.parse(rejectedDocument).run;
  const intended = rejected.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered');
  if (negative.status !== 1 || rejected.status !== 'failed' || rejected.errors?.length || intended.length !== 1 || intended[0].file !== 'tests/negative.e2e.ts' || intended[0].status !== 'failed' || intended[0].attempts.length !== 1 || intended[0].attempts[0]?.error?.code !== 'ASSERTION_FAILED' || intended[0].attempts[0]?.cleanup !== 'complete' || intended[0].attempts[0]?.secondaryErrors?.length) throw new Error(`Installed CLI did not reject the intended wrong result cleanly: status ${negative.status}; ${negative.stdout}; ${negative.stderr}; ${JSON.stringify(rejected.results)}`);
  if (intended[0].source?.file !== 'tests/negative.e2e.ts') throw new Error('Installed report source location does not preserve a consumer path with spaces');
  process.stdout.write('Installed CLI rejects a deliberate wrong output: passed\n');
  requireSuccess('Install consumer TypeScript checking tools', runPackageManager('npm', ['install', '--save-dev', '--no-audit', '--no-fund', 'typescript@7.0.2', '@types/node@26.4.1'], { cwd: project, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));
  writeFileSync(join(project, 'consumer-types.ts'), `import type { E2EConfig } from '@e2e-platform/core';
import { run } from '@e2e-platform/core/runner';
import { test } from '@e2e-platform/process/test';
import { ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile, ProcessRunner, runProcess, type ApplicationCommand, type ProcessSession } from '@e2e-platform/process';
import { OutputValidator, compareJson } from '@e2e-platform/checks';
import { NativeEngine, NativeDriver, NativeTransport, DesktopEngine, desktop, qt, type DesktopOptions, type NativeProcessLaunch } from '@e2e-platform/native';
import { TerminalTransport, terminal } from '@e2e-platform/terminal';
import { HttpTransport, createHttpClient } from '@e2e-platform/protocol';
const driverOptions = { backend: 'linux-atspi', executable: '/usr/bin/python3', args: ['/opt/e2e-platform/driver.py'] } satisfies DesktopOptions;
const desktopConfig = { modelPolicy: 'forbid', targets: [{ name: 'desktop', engine: desktop(driverOptions), app: { appPath: '/test/app' } }] } satisfies E2EConfig;
class CustomDesktopEngine extends DesktopEngine {}
const config = { modelPolicy: 'forbid', targets: [{ name: 'qt', engine: qt(), app: { appPath: '/test/app' } }] } satisfies E2EConfig;
class CustomLaunchProfile extends ApplicationLaunchProfile {
  constructor() { super({ identity: 'installed-custom' }); }
  protected override command(): ApplicationCommand { return { executable: process.execPath, args: [] }; }
}
class CustomNativeEngine extends NativeEngine {
  protected override createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> {
    return super.createProcess(launch);
  }
}
const profiles: readonly ApplicationLaunchProfile[] = [
  new PythonLaunchProfile({ identity: 'installed-python', interpreter: 'python', script: 'app.py' }),
  new DotnetLaunchProfile({ identity: 'installed-dotnet', dotnet: 'dotnet', assembly: 'app.dll' }),
  new ExecutableLaunchProfile({ identity: 'installed-executable', executable: process.execPath }),
  new CustomLaunchProfile(),
];
const launches = profiles.map((profile) => profile.resolve(['--version']));
export { desktopConfig, CustomDesktopEngine, config, run, test, profiles, launches, CustomLaunchProfile, CustomNativeEngine, ProcessRunner, runProcess, OutputValidator, compareJson, NativeDriver, NativeTransport, TerminalTransport, terminal, HttpTransport, createHttpClient };
`);
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'] }, include: ['consumer-types.ts', 'tests/*.ts'] }));
  node('Typecheck the installed public APIs and real tests', [join(project, 'node_modules/typescript/bin/tsc'), '--project', join(project, 'tsconfig.json')], project);
  writeFileSync(join(evidence, 'installed-consumer-typecheck-lock.json'), readFileSync(join(project, 'package-lock.json')));

  // npm's Windows cmd-shim 8.0.0 launcher uses unquoted SET dp0=%~dp0, so an
  // ampersand in its installation path is interpreted by cmd.exe. Keep the
  // complete direct-Node consumer proof above, then exercise the real npm
  // executable from a conventional path using these same installed packages.
  executableDirectory = mkdtempSync(join(tmpdir(), 'e2e npm executable '));
  const executableProject = join(executableDirectory, 'consumer project');
  if (process.platform === 'win32' && executableProject.includes('&')) throw new Error('Windows npm executable smoke requires a temporary parent path without ampersands');
  // Keep npm's saved relative tarball references valid after relocation.
  renameSync(kit, join(executableDirectory, 'package kit & files'));
  renameSync(project, executableProject);
  if (process.platform === 'win32') writeFileSync(join(evidence, 'installed-npm-launcher.cmd'), readFileSync(join(executableProject, 'node_modules/.bin/e2e-platform.cmd')));
  const executableHelp = runPackageManager('npm', ['exec', '--offline', '--', 'e2e-platform', '--help'], { cwd: executableProject, env, encoding: 'utf8', timeout: 30_000 });
  requireSuccess('Read the npm-installed executable help from a conventional path', executableHelp);
  if (!executableHelp.stdout.includes('e2e-platform')) throw new Error('npm executable help does not identify the fork executable');
  const terminalSetupHelp = runPackageManager('npm', ['exec', '--offline', '--', 'e2e-platform-terminal-setup', '--help'], { cwd: executableProject, env, encoding: 'utf8', timeout: 30_000 });
  requireSuccess('Read the npm-installed terminal setup command help', terminalSetupHelp);
  if (!terminalSetupHelp.stdout.includes('Usage: e2e-platform-terminal-setup')) throw new Error('npm terminal setup help has the wrong identity');
  rmSync(join(executableProject, '.e2e/report.json'));
  requireSuccess('Run the installed TypeScript process test through npm exec', runPackageManager('npm', ['exec', '--offline', '--', 'e2e-platform', 'run', 'tests/installed.e2e.ts', '--no-model', '--workers', '1'], { cwd: executableProject, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));
  const executableDocument = readFileSync(join(executableProject, '.e2e/report.json'), 'utf8');
  writeFileSync(join(evidence, 'installed-npm-exec-positive.json'), executableDocument);
  const executableRun = JSON.parse(executableDocument).run;
  const executableTests = executableRun.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered');
  const executableAttempt = executableTests[0]?.attempts[0];
  if (executableRun.runner?.name !== '@e2e-platform/core' || executableRun.runner?.version !== manifest.packages.find(({ name }) => name === '@e2e-platform/core')?.version || executableRun.status !== 'passed' || executableRun.errors?.length || executableTests.length !== 1 || executableTests[0].file !== 'tests/installed.e2e.ts' || executableTests[0].status !== 'passed' || executableTests[0].attempts.length !== 1 || executableAttempt?.cleanup !== 'complete' || executableAttempt?.error || executableAttempt?.secondaryErrors?.length) throw new Error('npm executable did not run the installed consumer test with complete cleanup');
  writeFileSync(join(evidence, 'install-kit-smoke-summary.json'), JSON.stringify({ passed: true, timestamp: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, packages: manifest.packages, audit: auditReport.metadata, consumerPaths: { installationAndDirectNode: 'spaces and ampersands', npmExecutable: 'spaces; no ampersands required on Windows' }, checks: ['default init and generated CLI example', 'desktop API imports and strict types', 'report source paths with spaces', 'checksum validation', 'npm install', 'npm ci', 'MIT license and metadata', 'native protocol-v1 schema and conformance fixtures', 'installed terminal setup command metadata and help through Node and npm exec', 'no upstream e2e package', 'plain Node imports and launch-profile inheritance', 'positive process test', 'direct Node CLI help identity in metacharacter path', 'npm executable help and TypeScript process test in conventional path', 'planted assertion failure with cleanup', 'strict public API, launch-profile and native-engine subclass TypeScript compilation'] }, null, 2) + '\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
  if (executableDirectory !== undefined) rmSync(executableDirectory, { recursive: true, force: true });
}
process.stdout.write('Packed kit installation and direct Node checks passed in paths with spaces and ampersands; npm executable checks passed in a conventional consumer path.\n');
