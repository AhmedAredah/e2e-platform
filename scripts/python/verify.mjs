/** Builds wheels and qualifies Python cases using a clean installed npm/wheel consumer. */
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runProcess } from '../../packages/process/dist/index.js';
import { validateNativeReport } from '../native/verification-report.mjs';
import { VerificationCompletionGuard } from '../native/completion-guard.mjs';

const guard = new VerificationCompletionGuard();
const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  python: { type: 'string' }, kit: { type: 'string' }, backend: { type: 'string' }, driver: { type: 'string' },
  'driver-arg': { type: 'string', multiple: true }, 'gui-python': { type: 'string' }, binding: { type: 'string' },
  'http-frameworks': { type: 'boolean' }, 'app-python': { type: 'string' },
} });
const binding = values.binding ?? 'PySide6';
if (!['PySide6', 'PyQt6'].includes(binding)) throw new Error('Select PySide6 or PyQt6');
const python = values.python ?? process.env.E2E_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
if (values.backend && values['http-frameworks']) throw new Error('Select desktop or HTTP framework qualification');
const evidence = join(root, '.e2e/python', values.backend ? `desktop-${values.backend}-${binding}` : values['http-frameworks'] ? 'http-frameworks' : 'installed');
await mkdir(evidence, { recursive: true });
await rm(join(evidence, 'qualification.json'), { force: true });
const temporary = await mkdtemp(join(tmpdir(), 'e2e Python installed '));
const env = { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };

/** Execute bounded real commands; a failed or incomplete run never creates qualification. */
async function command(executable, args, cwd = root, expectedExitCodes = [0]) {
  try {
    const result = await runProcess({ executable, args, cwd, env, expectedExitCodes, timeoutMs: 240000, maxOutputBytes: 8 * 1024 * 1024 });
    process.stdout.write(result.stdout.bytes); process.stderr.write(result.stderr.bytes);
    if (result.stdout.truncated || result.stderr.truncated) throw new Error('Qualification output budget exceeded');
    return result;
  } catch (error) {
    if (error.result) { process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes); }
    throw error;
  }
}

try {
  await command(process.execPath, [join(root, 'scripts/python/package.mjs'), '--check-version']);
  const kit = values.kit ? resolve(values.kit) : join(temporary, 'kit');
  if (!values.kit) await command(process.execPath, [join(root, 'scripts/native/pack.mjs'), kit]);
  const wheelhouse = join(temporary, 'wheelhouse');
  const source = join(temporary, 'sdk-source');
  await cp(join(root, 'sdks/python'), source, { recursive: true, filter: path => !/(?:^|[/\\])(?:build|dist|__pycache__|\.pytest_cache)(?:[/\\]|$)|\.egg-info/.test(path) });
  await command(python, ['-m', 'pip', 'wheel', '--no-deps', '--wheel-dir', wheelhouse, source]);
  const wheels = (await readdir(wheelhouse)).filter(name => name.endsWith('.whl'));
  if (wheels.length !== 1) throw new Error('Expected one freshly built Python SDK wheel');
  const wheel = join(wheelhouse, wheels[0]);
  await copyFile(wheel, join(evidence, wheels[0]));
  const environment = join(temporary, 'venv');
  await command(python, ['-m', 'venv', environment]);
  const interpreter = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await command(interpreter, ['-m', 'pip', 'install', wheel]);
  await command(interpreter, ['-m', 'pip', 'check']);
  await command(interpreter, ['-I', '-c', 'import e2e_platform,sys; assert e2e_platform.__file__.startswith(sys.prefix); print("Installed SDK imports without the source checkout")']);
  const project = join(temporary, 'consumer project');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'python-installed-consumer', private: true, type: 'module' }));
  await command(process.execPath, [join(kit, 'install.mjs'), project]);
  await copyFile(join(kit, 'manifest.json'), join(evidence, 'installed-kit-manifest.json'));
  await command(interpreter, ['-m', 'e2e_platform', 'init'], project);
  await command(interpreter, ['-m', 'e2e_platform', 'run', '--no-model'], project);
  validateNativeReport(JSON.parse(await readFile(join(project, '.e2e/report.json'), 'utf8')), { expected: 'passed', minimumResults: 1 });
  await rm(join(project, 'tests'), { recursive: true, force: true });
  await rm(join(project, 'python_tests'), { recursive: true, force: true });
  await copyFile(join(root, 'examples/with-python/tests/test_boundaries.py'), join(project, 'test_boundaries.py'));
  await copyFile(join(root, 'examples/with-python/tests/test_desktop.py'), join(project, 'test_desktop.py'));
  await copyFile(join(root, 'examples/with-python/tests/test_frameworks.py'), join(project, 'test_frameworks.py'));
  await copyFile(join(root, 'examples/with-python/apps/http_frameworks.py'), join(project, 'framework_app.py'));
  await cp(join(root, 'examples/with-languages/apps/python'), join(project, 'application'), { recursive: true, filter: path => !path.includes('__pycache__') });
  env.E2E_PYTHON_APP = join(project, 'application/main.py');
  const cases = values.backend ? ['qt_widgets', 'qt_quick'] : values['http-frameworks'] ? ['flask', 'django', 'fastapi'] : ['cli', 'http'];
  const results = [];
  for (const scenario of cases) {
    const gui = values.backend !== undefined;
    const frameworks = values['http-frameworks'] === true;
    const testName = gui ? 'test_python_desktop_controls' : frameworks ? 'test_framework_http' : `test_python_${scenario}`;
    const file = gui ? 'test_desktop.py' : frameworks ? 'test_frameworks.py' : 'test_boundaries.py';
    if (frameworks && !values['app-python']) throw new Error('HTTP qualification needs --app-python with the framework requirements installed');
    env.E2E_FRAMEWORK_PYTHON = values['app-python'];
    env.E2E_FRAMEWORK_APP = join(project, 'framework_app.py');
    env.E2E_HTTP_FRAMEWORK = scenario;
    if (frameworks) await command(values['app-python'], [join(project, 'framework_app.py'), scenario, '--probe'], project);
    if (gui && (!values.driver || !values['gui-python'])) throw new Error('Desktop qualification needs --driver and --gui-python with the chosen Qt binding installed');
    if (gui) await copyFile(join(root, `examples/with-python/apps/${scenario}.py`), join(project, 'app.py'));
    // Reference fixtures contain no user data; expose missing toolkit/display prerequisites before the sidecar's redacted diagnostics.
    if (gui) await command(values['gui-python'], [join(project, 'app.py'), '--probe', ...(binding === 'PyQt6' ? ['--pyqt6'] : [])], project);
    for (const wrong of [false, true]) {
      env.E2E_PLANTED_DEFECT = wrong ? '1' : '0';
      const name = `${scenario}-${wrong ? 'negative' : 'positive'}`;
      const output = join(evidence, name);
      await rm(output, { recursive: true, force: true });
      await writeFile(join(project, 'python.e2e.ts'), `import { registerPythonTests } from '@e2e-platform/python';\nawait registerPythonTests({ interpreter:${JSON.stringify(interpreter)}, cwd:${JSON.stringify(project)}, tests:[${JSON.stringify(`${file}::${testName}`)}], timeoutMs:40000 });\n`);
      const target = gui ? `engine:desktop(${JSON.stringify({ backend: values.backend, executable: resolve(values.driver), args: values['driver-arg'] ?? [], launchTimeout: 30000, requestTimeout: 10000 })}), app:${JSON.stringify({ appPath: resolve(values['gui-python']), launchArguments: [join(project, 'app.py'), ...(binding === 'PyQt6' ? ['--pyqt6'] : []), ...(wrong ? ['--wrong'] : [])] })}` : "platform:'process'";
      await writeFile(join(project, 'e2e.config.ts'), `${gui ? "import { desktop } from '@e2e-platform/native';\n" : ''}export default { modelPolicy:'forbid', workers:1, retries:0, timeout:45000, tests:['python.e2e.ts'], targets:[{name:${JSON.stringify(name)}, ${target}}] };\n`);
      await command(process.execPath, [join(project, 'node_modules/@e2e-platform/core/dist/cli/bin.js'), 'run', '--no-model', '--artifacts', join(output, 'artifacts')], project, [wrong ? 1 : 0]);
      validateNativeReport(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')), { expected: wrong ? 'failed' : 'passed', minimumResults: 1, failureTitle: `${file}::${testName}`, failureOracle: gui ? '[oracle:python-desktop]' : frameworks ? '[oracle:python-http-framework]' : '[oracle:python-output]' });
      results.push({ scenario, plantedDefect: wrong, status: wrong ? 'failed-as-expected' : 'passed', cleanup: 'complete' });
    }
  }
  const runtime = await command(interpreter, ['-c', 'import json,sys,pytest;print(json.dumps({"python":sys.version.split()[0],"pytest":pytest.__version__}))']);
  const guiRuntime = values.backend ? JSON.parse((await command(values['gui-python'], ['-c', `import importlib,json,sys; from importlib.metadata import version; c=importlib.import_module('${binding}.QtCore'); print(json.dumps({'python':sys.version.split()[0], 'binding':'${binding}', 'bindingVersion':version('${binding}'), 'qt':c.qVersion()}))`])).stdout.bytes.toString()) : null;
  const frameworks = values['http-frameworks'] ? JSON.parse((await command(values['app-python'], ['-c', 'import json;from importlib.metadata import version;print(json.dumps({name:version(name) for name in ["Flask","Django","fastapi","uvicorn"]}))'])).stdout.bytes.toString()) : null;
  await writeFile(join(evidence, 'qualification.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA ?? null, recordedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, node: process.version, runtime: JSON.parse(runtime.stdout.bytes.toString()), wheel: { file: wheels[0], sha256: createHash('sha256').update(await readFile(wheel)).digest('hex') }, installedConsumer: true, guiRuntime, frameworks, results }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
guard.complete();
