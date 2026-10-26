/** Runs ordinary CLI tests and retains independently checked Qt exports and masked captures. */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from '../../packages/process/dist/index.js';
import { compareJson } from '../../packages/checks/dist/index.js';
import { VerificationCompletionGuard } from './completion-guard.mjs';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';

const completion = new VerificationCompletionGuard();
const root = fileURLToPath(new URL('../../', import.meta.url));
const executable = process.env.E2E_QT_DEMO
  ?? requireExecutableTarget(configuredExecutables(join(root, 'examples/with-qt/build')), 'e2e_qt_demo');
const evidence = join(root, '.e2e', 'cpp', 'qt-exports');
const core = pathToFileURL(join(root, 'packages/e2e/dist/index.js')).href;
const native = pathToFileURL(join(root, 'packages/native/dist/index.js')).href;
const results = [];

/** Finds explicit screenshot evidence without relying on the runner's generated attempt names. */
async function screenshots(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await screenshots(path));
    else if (entry.name.endsWith('.png')) found.push(path);
  }
  return found;
}

for (const planted of [false, true]) {
  const name = planted ? 'qt-retained-planted-export' : 'qt-retained-export';
  const directory = join(evidence, name);
  const project = join(directory, 'project');
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(project, 'tests'), { recursive: true });
  const input = join(directory, 'input.csv');
  const output = join(directory, 'result.json');
  await writeFile(input, 'quantity,price\n4,12.5\n');
  await writeFile(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await writeFile(join(project, 'e2e.config.ts'), `import { qt } from ${JSON.stringify(native)};
export default { modelPolicy: 'forbid', workers: 1, targets: [{ name: ${JSON.stringify(name)}, engine: qt(), app: {
  appPath: ${JSON.stringify(executable)}, launchArguments: ${JSON.stringify(planted ? ['--bad-calculation'] : [])}
} }] };\n`);
  await writeFile(join(project, 'tests/export.e2e.ts'), `import { test, expect } from ${JSON.stringify(core)};
test('exports the current calculation and captures masked pixels', async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('input-path').fill(${JSON.stringify(input)});
  await screen.getByTestId('import').click();
  await expect(screen.getByTestId('status')).toHaveText('Imported');
  await screen.getByTestId('quantity').fill('6');
  await screen.getByTestId('currency').selectOption({ label: 'EUR' });
  await screen.getByTestId('tax').check();
  await screen.getByTestId('calculate').click();
  await expect(screen.getByTestId('result')).toHaveText(${JSON.stringify(planted ? 'Total: 83.50 EUR' : 'Total: 82.50 EUR')});
  await expect(screen.getByTestId('status')).toHaveText('Calculated');
  await screen.getByTestId('output-path').fill(${JSON.stringify(output)});
  await screen.getByTestId('export').click();
  await expect(screen.getByTestId('status')).toHaveText('Exported');
  await app.screenshot('masked-window');
});\n`);
  const execution = await runProcess({
    executable: process.execPath,
    args: [join(root, 'packages/e2e/dist/cli/bin.js'), 'run', '--no-model', '--workers', '1'],
    cwd: project,
    env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    timeoutMs: 120_000,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  process.stdout.write(execution.stdout.bytes);
  process.stderr.write(execution.stderr.bytes);
  const report = JSON.parse(await readFile(join(project, '.e2e/report.json'), 'utf8')).run;
  if (report.status !== 'passed' || report.errors?.length || report.results.length !== 1
    || report.results[0].status !== 'passed' || report.results[0].attempts.some((attempt) => attempt.cleanup !== 'complete' || attempt.secondaryErrors?.length)) {
    throw new Error('Qt export proof did not complete its intended test with successful cleanup');
  }
  const exported = JSON.parse(await readFile(output, 'utf8'));
  const comparison = compareJson(exported, { total: 82.5, currency: 'EUR' });
  if (comparison.matches !== !planted) throw new Error('The independent export oracle did not distinguish correct and planted results');
  const captures = await screenshots(join(project, '.e2e/artifacts'));
  if (captures.length !== 1) throw new Error('Expected exactly one explicit Qt screenshot');
  await copyFile(captures[0], join(directory, 'masked-window.png'));
  results.push({ name, planted, exported, independentOracleAccepted: comparison.matches, differences: comparison.differences, screenshot: `${name}/masked-window.png` });
}
await writeFile(join(evidence, 'qt-export-proof.json'), `${JSON.stringify({ platform: process.platform, inputFidelity: 'toolkit-events', displayPlatform: process.env.QT_QPA_PLATFORM ?? 'native-default', results }, null, 2)}\n`);
process.stdout.write('Retained Qt exports and explicit masked screenshots verified through the CLI.\n');
completion.complete();
