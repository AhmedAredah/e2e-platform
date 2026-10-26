import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPackageManager } from './package-manager.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cliArgs = process.argv.slice(2);
if (cliArgs.length !== 0 && (cliArgs.length !== 2 || cliArgs[0] !== '--kit')) throw new Error('Usage: node scripts/cpp/install-kit-smoke.mjs [--kit directory]');
const sourceKit = cliArgs.length === 0 ? undefined : resolve(cliArgs[1]);
const directory = mkdtempSync(join(tmpdir(), 'e2e kit with spaces & '));
const kit = join(directory, 'package kit & files');
const project = join(directory, 'consumer project & tests');
const env = { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };

/** Checks the real command outcome and prints its captured diagnostics on failure. */
function requireSuccess(label, result) {
  if (result.status !== 0) throw new Error(`${label} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  process.stdout.write(`${label}: passed\n`);
}

/** Runs an actual Node entry without a command shell. */
function node(label, args, cwd = root) {
  requireSuccess(label, spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));
}

try {
  mkdirSync(join(project, 'tests'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'cpp-kit-consumer', private: true, type: 'module' }));
  if (sourceKit === undefined) node('Pack kit into a path with spaces and ampersands', [join(root, 'scripts/cpp/pack.mjs'), kit]);
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
    if (!existsSync(join(installed, 'LICENSE')) || !readFileSync(join(installed, 'LICENSE'), 'utf8').includes('Permission is hereby granted')) throw new Error(`Missing MIT license for ${name}`);
  }
  const nativeSchemaDirectory = join(project, 'node_modules/@e2e-cpp/native/schema');
  for (const file of ['README.md', 'native-bridge-1.schema.json', 'fixtures/native-bridge-1.conformance.json']) {
    if (!existsSync(join(nativeSchemaDirectory, file))) throw new Error(`Installed native protocol file is missing: ${file}`);
  }
  const nativeSchema = JSON.parse(readFileSync(join(nativeSchemaDirectory, 'native-bridge-1.schema.json'), 'utf8'));
  const nativeFixtures = JSON.parse(readFileSync(join(nativeSchemaDirectory, 'fixtures/native-bridge-1.conformance.json'), 'utf8'));
  const initializeRequest = nativeSchema.$defs?.request?.oneOf?.find((frame) => frame.properties?.method?.const === 'initialize');
  if (nativeSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || nativeSchema.$id !== 'urn:e2e-cpp:native-bridge:1' || nativeSchema.$defs?.initialization?.properties?.protocolVersion?.const !== 1 || initializeRequest?.properties?.params?.properties?.protocolVersion?.const !== 1) throw new Error('Installed native schema does not describe protocol version 1');
  if (!Array.isArray(nativeFixtures) || !nativeFixtures.some((fixture) => fixture.valid === false) || !nativeFixtures.some((fixture) => fixture.valid === true && fixture.value?.method === 'initialize' && fixture.value.params?.protocolVersion === 1) || !nativeFixtures.some((fixture) => fixture.valid === true && fixture.value?.result?.protocolVersion === 1)) throw new Error('Installed native conformance fixtures do not contain the protocol-v1 request/response and negative cases');
  process.stdout.write('Installed native protocol-v1 schema and conformance fixtures: passed\n');
  const audit = runPackageManager('npm', ['audit', '--json'], { cwd: project, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  const evidence = join(root, '.e2e', 'cpp');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'install-kit-audit.json'), audit.stdout ?? '');
  writeFileSync(join(evidence, 'installed-consumer-package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(join(evidence, 'installed-consumer-package.json'), readFileSync(join(project, 'package.json')));
  writeFileSync(join(evidence, 'installed-kit-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  requireSuccess('Audit the installed C++ tool dependencies', audit);
  const auditReport = JSON.parse(audit.stdout);
  if (auditReport.metadata?.vulnerabilities?.total !== 0) throw new Error('Installed kit audit did not report zero vulnerabilities');
  writeFileSync(join(project, 'imports.mjs'), manifest.packages.map(({ name }) => `await import(${JSON.stringify(name)});`).join('\n') + `
import { ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile } from '@e2e-cpp/process';
import { NativeEngine } from '@e2e-cpp/native';
for (const constructor of [ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile, NativeEngine]) {
  if (typeof constructor !== 'function') throw new Error('An installed extension constructor is missing');
}
for (const constructor of [PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile]) {
  if (!(constructor.prototype instanceof ApplicationLaunchProfile)) throw new Error('Installed language profiles do not extend their public base class');
}
`);
  node('Import all installed packages in plain Node', [join(project, 'imports.mjs')], project);
  writeFileSync(join(project, 'e2e.config.ts'), "export default { modelPolicy: 'forbid', targets: [{ name: 'local', platform: 'test' }] };\n");
  writeFileSync(join(project, 'tests/installed.e2e.ts'), `import { test, expect } from '@e2e-cpp/process/test';
test('installed process fixture owns a real child', async ({ processes }) => {
  const child = await processes.run({ executable: process.execPath, args: ['-e', 'process.stdout.write("installed kit")'], timeoutMs: 5000 });
  expect(child.stdout.bytes.toString()).toBe('installed kit');
});\n`);
  node('Run a TypeScript test through the installed CLI', [join(project, 'node_modules/@e2e-cpp/core/dist/cli/bin.js'), 'run', '--no-model', '--workers', '1'], project);
  const help = runPackageManager('npm', ['exec', '--offline', '--', 'e2e-cpp', '--help'], { cwd: project, env, encoding: 'utf8', timeout: 30_000 });
  requireSuccess('Read the installed executable help', help);
  if (!help.stdout.includes('e2e-cpp')) throw new Error('Installed help does not identify the fork executable');
  const positiveDocument = readFileSync(join(project, '.e2e/report.json'), 'utf8');
  writeFileSync(join(evidence, 'installed-consumer-positive.json'), positiveDocument);
  const report = JSON.parse(positiveDocument).run;
  const passed = report.results[0];
  if (report.status !== 'passed' || report.errors?.length || report.results.length !== 1 || passed?.kind !== 'test' || passed.status !== 'passed' || passed.attempts.length !== 1 || passed.attempts[0]?.cleanup !== 'complete' || passed.attempts[0]?.error || passed.attempts[0]?.secondaryErrors?.length) throw new Error('Installed CLI did not record its intended passing test with complete cleanup');
  writeFileSync(join(project, 'tests/negative.e2e.ts'), `import { test, expect } from '@e2e-cpp/process/test';
test('rejects wrong output from an installed process fixture', async ({ processes }) => {
  const child = await processes.run({ executable: process.execPath, args: ['-e', 'process.stdout.write("wrong")'], timeoutMs: 5000 });
  expect(child.stdout.bytes.toString()).toBe('expected');
});\n`);
  const negative = spawnSync(process.execPath, [join(project, 'node_modules/@e2e-cpp/core/dist/cli/bin.js'), 'run', 'tests/negative.e2e.ts', '--no-model', '--workers', '1'], { cwd: project, env, encoding: 'utf8', timeout: 180_000 });
  const rejectedDocument = readFileSync(join(project, '.e2e/report.json'), 'utf8');
  writeFileSync(join(evidence, 'installed-consumer-negative.json'), rejectedDocument);
  const rejected = JSON.parse(rejectedDocument).run;
  const intended = rejected.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered');
  if (negative.status !== 1 || rejected.status !== 'failed' || rejected.errors?.length || intended.length !== 1 || intended[0].file !== 'tests/negative.e2e.ts' || intended[0].status !== 'failed' || intended[0].attempts.length !== 1 || intended[0].attempts[0]?.error?.code !== 'ASSERTION_FAILED' || intended[0].attempts[0]?.cleanup !== 'complete' || intended[0].attempts[0]?.secondaryErrors?.length) throw new Error(`Installed CLI did not reject the intended wrong result cleanly: status ${negative.status}; ${negative.stdout}; ${negative.stderr}; ${JSON.stringify(rejected.results)}`);
  process.stdout.write('Installed CLI rejects a deliberate wrong output: passed\n');
  requireSuccess('Install consumer TypeScript checking tools', runPackageManager('npm', ['install', '--save-dev', '--no-audit', '--no-fund', 'typescript@7.0.2', '@types/node@26.4.1'], { cwd: project, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));
  writeFileSync(join(project, 'consumer-types.ts'), `import type { E2EConfig } from '@e2e-cpp/core';
import { run } from '@e2e-cpp/core/runner';
import { test } from '@e2e-cpp/process/test';
import { ApplicationLaunchProfile, PythonLaunchProfile, DotnetLaunchProfile, ExecutableLaunchProfile, ProcessRunner, runProcess, type ApplicationCommand, type ProcessSession } from '@e2e-cpp/process';
import { OutputValidator, compareJson } from '@e2e-cpp/checks';
import { NativeEngine, NativeDriver, NativeTransport, qt, type NativeProcessLaunch } from '@e2e-cpp/native';
import { TerminalTransport, terminal } from '@e2e-cpp/terminal';
import { HttpTransport, createHttpClient } from '@e2e-cpp/protocol';
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
export { config, run, test, profiles, launches, CustomLaunchProfile, CustomNativeEngine, ProcessRunner, runProcess, OutputValidator, compareJson, NativeDriver, NativeTransport, TerminalTransport, terminal, HttpTransport, createHttpClient };
`);
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'] }, include: ['consumer-types.ts', 'tests/*.ts'] }));
  node('Typecheck the installed public APIs and real tests', [join(project, 'node_modules/typescript/bin/tsc'), '--project', join(project, 'tsconfig.json')], project);
  writeFileSync(join(evidence, 'installed-consumer-typecheck-lock.json'), readFileSync(join(project, 'package-lock.json')));
  writeFileSync(join(evidence, 'install-kit-smoke-summary.json'), JSON.stringify({ passed: true, timestamp: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, packages: manifest.packages, audit: auditReport.metadata, checks: ['checksum validation', 'npm install', 'npm ci', 'MIT license and metadata', 'native protocol-v1 schema and conformance fixtures', 'no upstream e2e package', 'plain Node imports and launch-profile inheritance', 'positive process test', 'CLI help identity', 'planted assertion failure with cleanup', 'strict public API, launch-profile and native-engine subclass TypeScript compilation'] }, null, 2) + '\n');
} finally { rmSync(directory, { recursive: true, force: true }); }
process.stdout.write('Packed npm kit works from paths containing spaces and ampersands.\n');
