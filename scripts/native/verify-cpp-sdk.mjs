/** Installs the C++ SDK and npm kit in isolation and executes compiled test bodies. */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationService, PredicateReadiness, runProcess } from '../../packages/process/dist/index.js';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
import { readBuildQualification } from './build-qualification.mjs';
import { validateNativeReport } from './verification-report.mjs';
import { VerificationCompletionGuard } from './completion-guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const options = new Set(process.argv.slice(2));
for (const option of options) if (option !== '--qt') throw new Error(`Unknown option: ${option}`);
const directory = await mkdtemp(join(tmpdir(), 'e2e-cpp-sdk-'));
const evidence = join(root, '.e2e/cpp/sdk');
const completion = new VerificationCompletionGuard();
const env = { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });

async function run(executable, args, { cwd = root, accepted = [0] } = {}) {
  let result;
  try { result = await runProcess({ executable, args, cwd, env, timeoutMs: 240_000, maxOutputBytes: 8 * 1024 * 1024, expectedExitCodes: accepted }); }
  catch (error) {
    if (error.result) { process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes); }
    throw error;
  }
  process.stdout.write(result.stdout.bytes);
  process.stderr.write(result.stderr.bytes);
  if (result.stdout.truncated || result.stderr.truncated) throw new Error('C++ SDK qualification output was truncated');
  return result;
}

async function build(source, buildDirectory, extra = []) {
  const query = join(buildDirectory, '.cmake/api/v1/query');
  await mkdir(query, { recursive: true });
  await writeFile(join(query, 'codemodel-v2'), '');
  await run('cmake', ['-S', source, '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release', ...extra]);
  await run('cmake', ['--build', buildDirectory, '--config', 'Release', '--parallel', '2']);
  return configuredExecutables(buildDirectory);
}

try {
  const prefix = join(directory, 'prefix');
  const sdkBuild = join(directory, 'sdk-build');
  const sdkTargets = await build(join(root, 'native/cpp-sdk'), sdkBuild, ['-DBUILD_TESTING=ON', `-DCMAKE_INSTALL_PREFIX=${prefix}`]);
  await run('ctest', ['--test-dir', sdkBuild, '-C', 'Release', '--output-on-failure', '--output-junit', join(evidence, 'sdk-ctest.xml')]);
  await run('cmake', ['--install', sdkBuild, '--config', 'Release']);
  for (const [source, installed] of [
    ['LICENSE', 'share/licenses/e2eCpp/LICENSE'],
    ['THIRD_PARTY.md', 'share/licenses/e2eCpp/THIRD_PARTY.md'],
    ['third_party/nlohmann/LICENSE.MIT', 'share/licenses/e2eCpp/nlohmann/LICENSE.MIT'],
    ['third_party/nlohmann/json.hpp', 'include/nlohmann/json.hpp'],
  ]) {
    if (!(await readFile(join(root, 'native/cpp-sdk', source))).equals(await readFile(join(prefix, installed)))) throw new Error(`Installed SDK file differs: ${installed}`);
  }
  env.CMAKE_PREFIX_PATH = [prefix, env.CMAKE_PREFIX_PATH].filter(Boolean).join(delimiter);
  const consumerBuild = join(directory, 'consumer-build');
  const consumerTargets = await build(join(root, 'native/cpp-sdk/tests/consumer'), consumerBuild);
  await run('ctest', ['--test-dir', consumerBuild, '-C', 'Release', '--output-on-failure', '--output-junit', join(evidence, 'consumer-ctest.xml')]);
  const examplesBuild = join(directory, 'examples-build');
  const testTargets = await build(join(root, 'examples/with-cpp-sdk'), examplesBuild);
  const appTargets = await build(join(root, 'examples/with-cpp-cli'), join(directory, 'app-build'), ['-DBUILD_TESTING=OFF']);
  env.E2E_CPP_BINARY = requireExecutableTarget(appTargets, 'e2e_cpp_calculator');

  const httpApplication = requireExecutableTarget(appTargets, 'e2e_cpp_http');
  const kit = join(directory, 'kit');
  const project = join(directory, 'runner');
  await mkdir(join(project, 'tests'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'e2e-installed-cpp-test-consumer', private: true, type: 'module' }));
  await run(process.execPath, [join(root, 'scripts/native/pack.mjs'), kit]);
  await run(process.execPath, [join(kit, 'install.mjs'), project]);
  await copyFile(join(kit, 'manifest.json'), join(evidence, 'installed-kit-manifest.json'));
  await writeFile(join(project, 'tests/compiled.e2e.ts'), `import { registerCppTests } from '@e2e-platform/cpp';
const executable = process.env['E2E_CPP_TEST_BINARY'];
if (!executable) throw new Error('Missing compiled test executable');
await registerCppTests({ executable });
`);
  const profiles = [
    { name: 'contract-equal', binary: requireExecutableTarget(sdkTargets, 'e2e_cpp_contract_cases'), contract: 'equal' },
    { name: 'contract-different', binary: requireExecutableTarget(sdkTargets, 'e2e_cpp_contract_cases'), contract: 'different', negative: true, title: 'C++ contract café 漢字' },
    { name: 'contract-nonfinite', binary: requireExecutableTarget(sdkTargets, 'e2e_cpp_contract_cases'), contract: 'nonfinite', incomplete: true },
    { name: 'contract-exit', binary: requireExecutableTarget(sdkTargets, 'e2e_cpp_contract_cases'), contract: 'exit', incomplete: true },
    { name: 'installed-consumer', binary: requireExecutableTarget(consumerTargets, 'installed_cpp_consumer') },
    { name: 'cli-positive', binary: requireExecutableTarget(testTargets, 'e2e_cpp_cli_tests') },
    { name: 'cli-negative', binary: requireExecutableTarget(testTargets, 'e2e_cpp_negative_tests'), negative: true, title: 'C++ test rejects a planted wrong CLI result' },
  ];
  profiles.push(
    { name: 'http-positive', binary: requireExecutableTarget(testTargets, 'e2e_cpp_http_tests'), http: true },
    { name: 'http-negative', binary: requireExecutableTarget(testTargets, 'e2e_cpp_http_tests'), http: true, negative: true, title: 'C++ test validates a real HTTP application' },
  );
  if (options.has('--qt')) {
    const app = requireExecutableTarget(configuredExecutables(join(root, 'examples/with-qt/build')), 'e2e_qt_demo');
    const runtimeResult = await run(app, ['--describe-runtime']);
    const runtime = JSON.parse(runtimeResult.stdout.bytes.toString('utf8'));
    if (typeof runtime.qt !== 'string' || typeof runtime.platform !== 'string' || typeof runtime.architecture !== 'string') throw new Error('SDK Qt application runtime identity is missing');
    if (env.E2E_REQUIRE_QPA_PLATFORM && runtime.platform !== env.E2E_REQUIRE_QPA_PLATFORM) throw new Error('SDK Qt application loaded an unexpected display plugin');
    const binary = requireExecutableTarget(testTargets, 'e2e_cpp_qt_tests');
    profiles.push({ name: 'qt-positive', binary, qtApp: app, runtime }, { name: 'qt-negative', binary, qtApp: app, runtime, negative: true, title: 'C++ test drives Qt accessible controls' });
  }
  const results = [];
  const cli = join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js');
  for (const profile of profiles) {
    env.E2E_CPP_TEST_BINARY = profile.binary;
    env.E2E_CPP_CONTRACT_CASE = profile.contract ?? 'equal';
    const target = profile.qtApp
      ? `engine: qt(), app: { appPath: ${JSON.stringify(profile.qtApp)}, launchArguments: ${JSON.stringify(profile.negative ? ['--bad-calculation'] : [])} }`
      : "platform: 'cpp-cli'";
    await writeFile(join(project, 'e2e.config.ts'), `${profile.qtApp ? "import { qt } from '@e2e-platform/native';\n" : ''}export default { modelPolicy: 'forbid', retries: 0, workers: 1, tests: './tests/compiled.e2e.ts', targets: [{ name: ${JSON.stringify(profile.name)}, ${target} }] };\n`);
    const output = join(evidence, profile.name);
    let service;
    if (profile.http) {
      service = await ApplicationService.start({
        process: { executable: httpApplication, args: profile.negative ? ['--wrong-result'] : [], env, timeoutMs: 60_000, maxOutputBytes: 65536 },
        startupTimeoutMs: 5000,
        readiness: new PredicateReadiness(({ session }) => {
          if (session.stdout.truncated || session.stderr.truncated) throw new Error('HTTP fixture startup output was truncated');
          const lines = session.stdout.bytes.toString('utf8').split('\n');
          lines.pop();
          const marker = lines.find((line) => line.startsWith('E2E_CPP_HTTP_READY '));
          if (!marker) return false;
          const port = JSON.parse(marker.slice('E2E_CPP_HTTP_READY '.length)).port;
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HTTP fixture announced an invalid port');
          env.E2E_CPP_HTTP_BASE_URL = `http://127.0.0.1:${port}`;
          return true;
        }),
      });
    }
    let operationFailure;
    let cleanupFailure;
    try {
      await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', join(output, 'artifacts')], { cwd: project, accepted: [profile.negative || profile.incomplete ? 1 : 0] });
      const document = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      const report = profile.incomplete ? document.run : validateNativeReport(document, { expected: profile.negative ? 'failed' : 'passed', minimumResults: 1, failureTitle: profile.title, failureOracle: '[oracle:calculation]' });
      if (profile.incomplete) {
        const test = report.results?.[0]; const attempt = test?.attempts?.[0];
        if (document.schemaVersion !== 'report-1' || report.status !== 'failed' || report.errors?.length
          || report.results.length !== 1 || test.status !== 'failed' || test.titlePath.at(-1) !== 'C++ contract café 漢字'
          || test.attempts.length !== 1 || attempt.cleanup !== 'complete' || attempt.secondaryErrors?.length
          || !attempt.error?.message?.includes('exited before completing its registered body')) throw new Error('Compiled premature completion regression was not rejected as intended');
      }
      service?.assertHealthy();
      results.push({ name: profile.name, status: report.status, cleanup: 'complete', assertionFailureRequired: Boolean(profile.negative), ...(profile.runtime ? { runtime: profile.runtime, inputFidelity: 'toolkit-events' } : {}) });
    } catch (error) { operationFailure = error; }
    delete env.E2E_CPP_HTTP_BASE_URL;
    if (service) {
      try {
        const stopped = await service.stop();
        if (stopped.ioError !== undefined || stopped.status !== 'stopped') throw new Error('HTTP application cleanup did not complete');
      } catch (error) { cleanupFailure = error; }
    }
    if (operationFailure !== undefined && cleanupFailure !== undefined) throw new AggregateError([operationFailure, cleanupFailure], 'HTTP verification and cleanup failed');
    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (operationFailure !== undefined) throw operationFailure;
  }
  const adapter = JSON.parse(await readFile(join(project, 'node_modules/@e2e-platform/cpp/package.json'), 'utf8'));
  await writeFile(join(evidence, 'qualification.json'), `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? null, platform: process.platform, architecture: process.arch, node: process.version, adapter: adapter.version, isolatedInstalledKit: true, installedHeaders: true, toolchain: readBuildQualification(examplesBuild), results }, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write('Installed C++ SDK, external CMake consumer and compiled positive/negative tests passed.\n');
completion.complete();
