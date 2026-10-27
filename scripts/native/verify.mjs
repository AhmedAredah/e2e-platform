/** Builds real C++ targets, runs CTest and the built e2e CLI, and proves planted defects fail. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
import { VerificationCompletionGuard } from './completion-guard.mjs';
import { validateNativeReport } from './verification-report.mjs';
import { readBuildQualification } from './build-qualification.mjs';
import { verifyBuild } from '../dist-integrity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cliExample = join(root, 'examples', 'with-cpp-cli');
const cli = join(root, 'packages', 'e2e', 'dist', 'cli', 'bin.js');
const options = new Set(process.argv.slice(2));
const completion = new VerificationCompletionGuard();
rmSync(join(root, '.e2e', 'cpp', 'verification.json'), { force: true });
for (const argument of options) {
  if (!['--qt', '--qt-only', '--require-quick'].includes(argument)) throw new Error(`unknown argument: ${argument}`);
}
if (options.has('--require-quick') && !options.has('--qt') && !options.has('--qt-only')) throw new Error('--require-quick requires --qt or --qt-only');
if (!existsSync(cli) || !existsSync(join(root, 'packages', 'process', 'dist', 'index.js'))) {
  throw new Error('build the e2e and extension workspace packages before native verification');
}
for (const name of ['e2e', 'process']) verifyBuild(join(root, 'packages', name));
const { runProcess } = await import('../../packages/process/dist/index.js');
const env = { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };

/** Executes a reviewed argument array through the owned-tree supervisor, never a command shell. */
async function run(command, args, cwd, accepted = [0]) {
  process.stdout.write(`$ ${command} ${args.map((value) => JSON.stringify(value)).join(' ')}\n`);
  let result;
  try {
    result = await runProcess({ executable: command, args, cwd, env, timeoutMs: 180_000, maxOutputBytes: 8 * 1024 * 1024, expectedExitCodes: accepted });
  } catch (cause) {
    if (cause.result) printOutput(cause.result);
    throw cause;
  }
  printOutput(result);
  if (result.stdout.truncated || result.stderr.truncated) throw new Error('verification output exceeded its bounded capture; inspect the command separately');
  return result;
}

/** Writes captured controller output after its pipes and process tree have settled. */
function printOutput(result) {
  process.stdout.write(result.stdout.bytes);
  process.stderr.write(result.stderr.bytes);
}

/** Links only built workspace packages; downloads nothing and refuses to overwrite installed directories. */
function linkPackages(example, packages) {
  for (const name of packages) {
    const source = join(root, 'packages', name === '@e2e-platform/core' ? 'e2e' : name.slice('@e2e-platform/'.length));
    if (!existsSync(join(source, 'dist', 'index.js'))) throw new Error(`build ${name} before verification (missing ${source}/dist/index.js)`);
    verifyBuild(source);
    const destination = join(example, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    let entry;
    try { entry = lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry !== undefined) {
      if (realpathSync(destination) === realpathSync(source)) continue;
      if (!entry.isSymbolicLink()) throw new Error(`${destination} already exists; use a clean source checkout or remove that example's installed dependency first`);
      rmSync(destination);
    }
    symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

/** Requires complete cleanup and the intended assertion failure, never a broken setup or skipped test. */
function verifyReport(reportPath, expected, minimumResults, failureTitle) {
  return validateNativeReport(JSON.parse(readFileSync(reportPath, 'utf8')), { expected, minimumResults, failureTitle, failureOracle: '[oracle:calculation]' });
}

/** Finds retained evidence without assuming the test's Unicode subdirectory name. */
function findFile(directory, name, depth = 0) {
  if (depth > 4) throw new Error('unexpected evidence directory depth');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return join(directory, name);
    if (entry.isDirectory()) {
      const found = findFile(join(directory, entry.name), name, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** Configures an explicit File API query, builds, then runs CTest through the process supervisor. */
async function build(source, buildDirectory) {
  const query = join(buildDirectory, '.cmake', 'api', 'v1', 'query');
  mkdirSync(query, { recursive: true });
  writeFileSync(join(query, 'codemodel-v2'), '');
  await run('cmake', ['-S', source, '-B', buildDirectory, '-DBUILD_TESTING=ON', '-DCMAKE_BUILD_TYPE=Release'], root);
  await run('cmake', ['--build', buildDirectory, '--config', 'Release', '--parallel', '2'], root);
  await run('ctest', ['--test-dir', buildDirectory, '-C', 'Release', '--output-on-failure', '--output-junit', join(buildDirectory, 'ctest-results.xml')], root);
  return configuredExecutables(buildDirectory);
}

const summary = { schemaVersion: 2, recordedAt: new Date().toISOString(), sourceCommit: process.env.GITHUB_SHA ?? null, buildConfiguration: 'Release', platform: process.platform, architecture: process.arch, node: process.version, cli: null, qt: null };
if (!options.has('--qt-only')) {
  linkPackages(cliExample, ['@e2e-platform/core', '@e2e-platform/process', '@e2e-platform/checks', '@e2e-platform/protocol']);
  const targets = await build(cliExample, join(cliExample, 'build'));
  env.E2E_CPP_BINARY = requireExecutableTarget(targets, 'e2e_cpp_calculator');
  const retainedEvidence = join(cliExample, '.e2e', 'cpp-evidence');
  mkdirSync(retainedEvidence, { recursive: true });
  env.E2E_CPP_EVIDENCE = mkdtempSync(join(retainedEvidence, 'verification-'));
  for (const name of ['positive', 'planted-negative']) rmSync(join(cliExample, '.e2e', name), { recursive: true, force: true });
  await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', '.e2e/positive/artifacts'], cliExample);
  const positive = verifyReport(join(cliExample, '.e2e', 'positive', 'report.json'), 'passed', 3);
  await run(process.execPath, [cli, 'run', '--config', 'e2e.negative.config.ts', '--no-model', '--artifacts', '.e2e/planted-negative/artifacts'], cliExample, [1]);
  verifyReport(join(cliExample, '.e2e', 'planted-negative', 'report.json'), 'failed', 1, 'rejects the planted wrong result even though the program exits successfully');
  const evidenceRoot = env.E2E_CPP_EVIDENCE;
  const directories = readdirSync(evidenceRoot).filter((name) => name.startsWith('planted-wrong-output-'));
  if (directories.length !== 1) throw new Error('expected exactly one planted-defect export directory');
  const badPath = findFile(join(evidenceRoot, directories[0]), 'result.json');
  if (!badPath || JSON.parse(readFileSync(badPath, 'utf8')).sum !== 5) throw new Error('the planted wrong-output executable path was not exercised');
  env.E2E_CPP_HTTP_BINARY = requireExecutableTarget(targets, 'e2e_cpp_http');
  for (const negative of [false, true]) {
    const name = negative ? 'http-negative' : 'http-positive';
    rmSync(join(cliExample, '.e2e', name), { recursive: true, force: true });
    await run(process.execPath, [cli, 'run', '--config', negative ? 'e2e.http.negative.config.ts' : 'e2e.http.config.ts', '--no-model', '--artifacts', `.e2e/${name}/artifacts`], cliExample, [negative ? 1 : 0]);
    verifyReport(join(cliExample, '.e2e', name, 'report.json'), negative ? 'failed' : 'passed', 1, 'rejects the planted wrong C++ HTTP result despite status 200');
  }
  summary.cli = { http: { referenceServer: true, positivePassed: true, plantedDefectRejected: true, frameworkCertification: false }, toolchain: readBuildQualification(join(cliExample, 'build')), passedTests: positive.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered').length, plantedDefectRejected: true, evidence: 'examples/with-cpp-cli/.e2e/', exportEvidence: relative(root, evidenceRoot).split('\\').join('/') };
}

if (options.has('--qt') || options.has('--qt-only')) {
  const example = join(root, 'examples', 'with-qt');
  const project = join(example, 'e2e');
  linkPackages(project, ['@e2e-platform/core', '@e2e-platform/native', '@e2e-platform/checks']);
  const targets = await build(example, join(example, 'build'));
  env.E2E_QT_DEMO = requireExecutableTarget(targets, 'e2e_qt_demo');
  const runtimeResult = await run(env.E2E_QT_DEMO, ['--describe-runtime'], root);
  const runtime = JSON.parse(runtimeResult.stdout.bytes.toString('utf8'));
  if (typeof runtime.qt !== 'string' || typeof runtime.platform !== 'string' || typeof runtime.architecture !== 'string') throw new Error('Qt runtime identity is missing');
  if (env.E2E_REQUIRE_QPA_PLATFORM && runtime.platform !== env.E2E_REQUIRE_QPA_PLATFORM) throw new Error(`Expected Qt QPA ${env.E2E_REQUIRE_QPA_PLATFORM}, received ${runtime.platform}`);
  for (const name of ['verification-widgets', 'verification-negative', 'verification-quick', 'verification-quick-negative']) rmSync(join(project, '.e2e', name), { recursive: true, force: true });
  await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', '.e2e/verification-widgets/artifacts'], project);
  const widgets = verifyReport(join(project, '.e2e', 'verification-widgets', 'report.json'), 'passed', 3);
  env.E2E_QT_BAD_CALCULATION = '1';
  try {
    await run(process.execPath, [cli, 'run', '--no-model', '--artifacts', '.e2e/verification-negative/artifacts'], project, [1]);
    verifyReport(join(project, '.e2e', 'verification-negative', 'report.json'), 'failed', 3, 'imports a project, edits its data, computes asynchronously, and exports');
  } finally {
    delete env.E2E_QT_BAD_CALCULATION;
  }
  const quick = targets.get('e2e_qt_quick_demo');
  let quickTests = 0;
  if (quick) {
    env.E2E_QT_QUICK_DEMO = requireExecutableTarget(targets, 'e2e_qt_quick_demo');
    await run(process.execPath, [cli, 'run', '--config', 'e2e.quick.config.ts', '--no-model', '--artifacts', '.e2e/verification-quick/artifacts'], project);
    const quickReport = verifyReport(join(project, '.e2e', 'verification-quick', 'report.json'), 'passed', 1);
    quickTests = quickReport.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered').length;
    env.E2E_QT_BAD_CALCULATION = '1';
    try {
      await run(process.execPath, [cli, 'run', '--config', 'e2e.quick.config.ts', '--no-model', '--artifacts', '.e2e/verification-quick-negative/artifacts'], project, [1]);
      verifyReport(join(project, '.e2e', 'verification-quick-negative', 'report.json'), 'failed', 1, 'drives a Qt Quick calculation through the visual tree');
    } finally {
      delete env.E2E_QT_BAD_CALCULATION;
    }
  } else if (options.has('--require-quick')) {
    throw new Error('Qt Quick was required but is not part of the current CMake configuration');
  } else {
    process.stdout.write('Qt Quick was not built; no Quick runtime qualification is recorded.\n');
  }
  summary.qt = { runtime, toolchain: readBuildQualification(join(example, 'build')), quickPlantedDefectRejected: Boolean(quick), widgetsPassed: true, widgetsTests: widgets.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered').length, plantedDefectRejected: true, quickPassed: Boolean(quick), quickTests, inputFidelity: 'toolkit-events', displayPlatform: env.QT_QPA_PLATFORM ?? 'native-default', evidence: 'examples/with-qt/e2e/.e2e/' };
}

const summaryDirectory = join(root, '.e2e', 'cpp');
mkdirSync(summaryDirectory, { recursive: true });
writeFileSync(join(summaryDirectory, 'verification.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`C++ verification passed: ${JSON.stringify(summary)}\n`);
completion.complete();
