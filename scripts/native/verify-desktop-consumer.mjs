/** Qualifies installed TypeScript and C++ APIs against a real, explicitly supplied OS sidecar. */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
import { validateNativeReport } from './verification-report.mjs';
import { VerificationCompletionGuard } from './completion-guard.mjs';

const completion = new VerificationCompletionGuard();
const root = fileURLToPath(new URL('../../', import.meta.url));
const platforms = { 'linux-atspi': 'linux', 'windows-uia': 'win32', 'macos-ax': 'darwin' };
const backend = Object.keys(platforms).find(key => platforms[key] === process.platform);
if (!backend) throw new Error('Desktop consumer qualification requires Linux, Windows or macOS');
const evidence = join(root, '.e2e/desktop-consumer', backend);
await rm(evidence, { recursive: true, force: true });
const { values } = parseArgs({ options: {
  backend: { type: 'string' }, driver: { type: 'string' }, app: { type: 'string' },
  'driver-arg': { type: 'string', multiple: true }, 'app-arg': { type: 'string', multiple: true },
  'wrong-arg': { type: 'string' },
  python: { type: 'string' },
}});
if (!Object.hasOwn(platforms, values.backend) || platforms[values.backend] !== process.platform || !values.driver || !values.app || !values['wrong-arg']) {
  throw new Error('Select the actual host backend and supply --driver, --app and --wrong-arg');
}
const { runProcess } = await import('../../packages/process/dist/index.js');
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'e2e-desktop-consumer-'));
const env = { ...process.env, E2E_DESKTOP_BACKEND: values.backend, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };

/** Run real tools with bounded output and preserve failures for diagnosis. */
async function run(executable, args, cwd = root, expectedExitCodes = [0]) {
  try {
    const result = await runProcess({ executable, args, cwd, env, expectedExitCodes, timeoutMs: 240000, maxOutputBytes: 8 * 1024 * 1024 });
    process.stdout.write(result.stdout.bytes);
    process.stderr.write(result.stderr.bytes);
    if (result.stdout.truncated || result.stderr.truncated) throw new Error('Desktop consumer output exceeded its evidence budget');
    return result;
  } catch (error) {
    if (error.result) { process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes); }
    throw error;
  }
}

/** Build external consumers using only the installed CMake package. */
async function build(source, buildDirectory, args = []) {
  await mkdir(join(buildDirectory, '.cmake/api/v1/query'), { recursive: true });
  await writeFile(join(buildDirectory, '.cmake/api/v1/query/codemodel-v2'), '');
  await run('cmake', ['-S', source, '-B', buildDirectory, '-DCMAKE_BUILD_TYPE=Release', ...args]);
  await run('cmake', ['--build', buildDirectory, '--config', 'Release', '--parallel', '2']);
  return configuredExecutables(buildDirectory);
}

try {
  const prefix = join(directory, 'prefix');
  const sdk = join(directory, 'sdk');
  await build(join(root, 'native/cpp-sdk'), sdk, ['-DBUILD_TESTING=OFF', `-DCMAKE_INSTALL_PREFIX=${prefix}`]);
  await run('cmake', ['--install', sdk, '--config', 'Release']);
  const targets = await build(join(root, 'examples/with-cpp-sdk'), join(directory, 'tests'), [`-DCMAKE_PREFIX_PATH=${prefix}`]);
  const binary = requireExecutableTarget(targets, 'e2e_cpp_desktop_tests');
  const kit = join(directory, 'kit');
  const project = join(directory, 'project');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'installed-desktop-consumer', type: 'module', private: true }));
  await run(process.execPath, [join(root, 'scripts/native/pack.mjs'), kit]);
  await run(process.execPath, [join(kit, 'install.mjs'), project]);
  await copyFile(join(kit, 'manifest.json'), join(evidence, 'installed-kit-manifest.json'));
  await copyFile(join(root, 'examples/with-desktop/tests/consumer.e2e.ts'), join(project, 'typescript.e2e.ts'));
  await writeFile(join(project, 'cpp.e2e.ts'), `import { registerCppTests } from '@e2e-platform/cpp';\nawait registerCppTests({ executable: ${JSON.stringify(binary)} });\n`);
  if (values.python) {
    await copyFile(join(root, 'examples/with-desktop/tests/consumer.py'), join(project, 'test_desktop.py'));
    await writeFile(join(project, 'python.e2e.ts'), `import { registerPythonTests } from '@e2e-platform/python';\nawait registerPythonTests({ interpreter:${JSON.stringify(resolve(values.python))}, cwd:${JSON.stringify(project)}, tests:['test_desktop.py'], timeoutMs:40000 });\n`);
  }
  const cli = join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js');
  const results = [];
  for (const language of ['typescript', 'cpp', ...(values.python ? ['python'] : [])]) {
    for (const wrong of [false, true]) {
      const name = `${language}-${wrong ? 'negative' : 'positive'}`;
      const options = { backend: values.backend, executable: resolve(values.driver), args: values['driver-arg'] ?? [], launchTimeout: 30000, requestTimeout: 10000 };
      const app = { appPath: resolve(values.app), launchArguments: [...values['app-arg'] ?? [], ...(wrong ? [values['wrong-arg']] : [])] };
      await writeFile(join(project, 'e2e.config.ts'), `import { desktop } from '@e2e-platform/native';\nexport default { modelPolicy:'forbid', retries:0, workers:2, timeout:45000, tests:'./${language}.e2e.ts', targets:[{name:${JSON.stringify(name)}, engine:desktop(${JSON.stringify(options)}), app:${JSON.stringify(app)}}] };\n`);
      const output = join(evidence, name);
      await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', join(output, 'artifacts')], project, [wrong ? 1 : 0]);
      const report = validateNativeReport(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')), {
        expected: wrong ? 'failed' : 'passed', minimumResults: 1,
        failureTitle: language === 'python' ? 'test_desktop.py::test_installed_python_desktop_consumer' : language === 'cpp' ? 'installed C++ desktop consumer validates application output' : 'installed desktop consumer validates application output',
        failureOracle: '[oracle:desktop-output]',
      });
      results.push({ language, plantedDefect: wrong, status: report.status, cleanup: 'complete' });
    }
  }
  await writeFile(join(evidence, 'qualification.json'), JSON.stringify({
    schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, recordedAt: new Date().toISOString(),
    backend: values.backend, platform: process.platform, architecture: process.arch, node: process.version,
    installedKit: true, installedHeaders: true, results,
  }, null, 2) + '\n');
  process.stdout.write('Installed public desktop APIs and compiled C++ consumers passed positive and planted-defect verification.\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
completion.complete();
