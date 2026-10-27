/** Drives installed static/shared Qt helpers using an isolated installed JavaScript kit. */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../packages/process/dist/index.js';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
import { readBuildQualification } from './build-qualification.mjs';
import { validateNativeReport } from './verification-report.mjs';
import { VerificationCompletionGuard } from './completion-guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'e2e-qt-installed-gui-'));
const evidence = join(root, '.e2e', 'cpp', 'qt-installed');
const completion = new VerificationCompletionGuard();
const profiles = [];
await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });

/** Executes commands with bounded output and preserves expected assertion failures. */
async function run(executable, args, { env = process.env, cwd = root, accepted = [0] } = {}) {
  let result;
  try { result = await runProcess({ executable, args, env, cwd, timeoutMs: 240_000, maxOutputBytes: 8 * 1024 * 1024, expectedExitCodes: accepted }); }
  catch (error) {
    if (error.result) { process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes); }
    throw error;
  }
  process.stdout.write(result.stdout.bytes);
  process.stderr.write(result.stderr.bytes);
  if (result.stdout.truncated || result.stderr.truncated) throw new Error('Installed Qt qualification output was truncated');
  return result;
}

try {
  const kit = join(directory, 'kit');
  const project = join(directory, 'consumer');
  const source = join(project, 'src');
  await mkdir(join(source, 'ui'), { recursive: true });
  await mkdir(join(source, 'quick'), { recursive: true });
  await mkdir(join(project, 'tests'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'e2e-installed-qt-consumer', private: true, type: 'module' }));
  await run(process.execPath, [join(root, 'scripts/native/pack.mjs'), kit]);
  await run(process.execPath, [join(kit, 'install.mjs'), project]);
  await copyFile(join(kit, 'manifest.json'), join(evidence, 'installed-kit-manifest.json'));
  for (const filename of ['main.cpp', 'runtime_metadata.h', 'ui/calculator_window.cpp', 'ui/calculator_window.h', 'quick/main.cpp', 'quick/Main.qml']) {
    await copyFile(join(root, 'examples/with-qt', filename), join(source, filename));
  }
  await copyFile(join(root, 'examples/with-qt/e2e/tests/calculator.e2e.ts'), join(project, 'tests/calculator.e2e.ts'));
  await copyFile(join(root, 'examples/with-qt/e2e/tests-quick/calculator.e2e.ts'), join(project, 'tests/quick.e2e.ts'));
  await writeFile(join(source, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.21)
project(e2e_installed_qt_consumer LANGUAGES CXX)
find_package(e2eQtBridge CONFIG REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Widgets Quick Qml)
add_executable(installed_qt_consumer main.cpp ui/calculator_window.cpp)
target_compile_features(installed_qt_consumer PRIVATE cxx_std_17)
target_link_libraries(installed_qt_consumer PRIVATE E2E::QtBridge Qt6::Widgets)
add_executable(installed_qt_quick_consumer quick/main.cpp)
target_compile_features(installed_qt_quick_consumer PRIVATE cxx_std_17)
target_link_libraries(installed_qt_quick_consumer PRIVATE E2E::QtBridge Qt6::Widgets Qt6::Quick Qt6::Qml)
add_custom_command(TARGET installed_qt_quick_consumer POST_BUILD
  COMMAND "\${CMAKE_COMMAND}" -E copy_if_different "\${CMAKE_CURRENT_SOURCE_DIR}/quick/Main.qml" "$<TARGET_FILE_DIR:installed_qt_quick_consumer>/Main.qml")
`);
  const cli = join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js');
  for (const shared of ['OFF', 'ON']) {
    const name = shared === 'ON' ? 'shared' : 'static';
    const build = join(directory, `bridge-${name}`);
    const prefix = join(directory, `install-${name}`);
    const consumer = join(directory, `consumer-${name}`);
    await run('cmake', ['-S', join(root, 'native/qt'), '-B', build, '-DBUILD_TESTING=OFF', `-DBUILD_SHARED_LIBS=${shared}`, '-DCMAKE_CXX_VISIBILITY_PRESET=hidden', '-DCMAKE_VISIBILITY_INLINES_HIDDEN=ON', '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_INSTALL_PREFIX=${prefix}`]);
    await run('cmake', ['--build', build, '--config', 'Release', '--parallel', '2']);
    await run('cmake', ['--install', build, '--config', 'Release']);
    for (const filename of ['LICENSE', 'THIRD_PARTY.md']) {
      const expected = await readFile(join(root, 'native/qt', filename));
      const installed = await readFile(join(prefix, 'share/licenses/e2eQtBridge', filename));
      if (!expected.equals(installed)) throw new Error(`Installed Qt ${filename} differs from its source`);
    }
    const env = {
      ...process.env,
      CMAKE_PREFIX_PATH: [prefix, process.env.CMAKE_PREFIX_PATH].filter(Boolean).join(delimiter),
      PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1',
    };
    const extensionConsumer = join(directory, `extension-consumer-${name}`);
    await run('cmake', ['-S', join(root, 'native/qt/tests/consumer'), '-B', extensionConsumer, '-DCMAKE_BUILD_TYPE=Release'], { env });
    await run('cmake', ['--build', extensionConsumer, '--config', 'Release', '--parallel', '2'], { env });
    await run('ctest', ['--test-dir', extensionConsumer, '-C', 'Release', '--output-on-failure', '--output-junit', join(evidence, `${name}-extension-consumer.xml`)], { env });
    const query = join(consumer, '.cmake/api/v1/query');
    await mkdir(query, { recursive: true });
    await writeFile(join(query, 'codemodel-v2'), '');
    await run('cmake', ['-S', source, '-B', consumer, '-DCMAKE_BUILD_TYPE=Release'], { env });
    await run('cmake', ['--build', consumer, '--config', 'Release', '--parallel', '2'], { env });
    for (const toolkit of ['widgets', 'quick']) {
      const executable = requireExecutableTarget(configuredExecutables(consumer), toolkit === 'quick' ? 'installed_qt_quick_consumer' : 'installed_qt_consumer');
      const runtimeResult = await run(executable, ['--describe-runtime'], { env });
      const runtime = JSON.parse(runtimeResult.stdout.bytes.toString('utf8'));
      if (typeof runtime.qt !== 'string' || typeof runtime.platform !== 'string' || typeof runtime.architecture !== 'string') throw new Error('Installed Qt runtime identity is missing');
      if (env.E2E_REQUIRE_QPA_PLATFORM && runtime.platform !== env.E2E_REQUIRE_QPA_PLATFORM) throw new Error(`Installed Qt expected ${env.E2E_REQUIRE_QPA_PLATFORM}, received ${runtime.platform}`);
      for (const negative of [false, true]) {
        const label = `${name}-${toolkit}-${negative ? 'negative' : 'positive'}`;
        const output = join(evidence, label);
        await writeFile(join(project, 'e2e.config.ts'), `import { qt } from '@e2e-platform/native';
  export default { modelPolicy: 'forbid', retries: 0, workers: 1, tests: ${JSON.stringify(toolkit === 'quick' ? './tests/quick.e2e.ts' : './tests/calculator.e2e.ts')},
    targets: [{ name: ${JSON.stringify(label)}, engine: qt(), app: {
      appPath: ${JSON.stringify(executable)}, launchArguments: ${JSON.stringify(negative ? ['--bad-calculation'] : [])}
    } }] };
  `);
        await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', join(output, 'artifacts')], { env, cwd: project, accepted: [negative ? 1 : 0] });
        const report = validateNativeReport(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')), {
          expected: negative ? 'failed' : 'passed', minimumResults: toolkit === 'quick' ? 1 : 3,
          failureOracle: '[oracle:calculation]', failureTitle: toolkit === 'quick' ? 'drives a Qt Quick calculation through the visual tree' : 'imports a project, edits its data, computes asynchronously, and exports',
        });
        profiles.push({ library: name, toolkit, scenario: negative ? 'planted-defect' : 'positive', verdict: report.status, tests: report.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered').length, cleanup: 'complete', runtime, toolchain: readBuildQualification(consumer) });
      }
    }
  }
  await writeFile(join(evidence, 'qualification.json'), `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? null, platform: process.platform, architecture: process.arch, node: process.version, displayPlatform: process.env.QT_QPA_PLATFORM ?? 'native-default', inputFidelity: 'toolkit-events', isolatedInstalledKit: true, profiles }, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
completion.complete();
process.stdout.write('Installed static/shared Qt GUI workflows and planted-defect rejection passed through the isolated installed runner.\n');
