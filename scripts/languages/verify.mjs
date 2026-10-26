/** Qualifies all three languages using the installed runner and checks every expected failure. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../packages/process/dist/index.js';
import { buildApplications } from './build.mjs';
import { validateLanguageReport } from './report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const example = path.join(root, 'examples', 'with-languages');
const cli = path.join(root, 'packages', 'e2e', 'dist', 'cli', 'bin.js');
const summaryFile = path.join(root, '.e2e', 'languages', 'verification.json');
let completed = false;
process.once('beforeExit', () => {
  if (!completed && !process.exitCode) { process.stderr.write('Language verification did not complete.\n'); process.exitCode = 1; }
});
await rm(summaryFile, {force: true});
const manifest = await buildApplications();
const env = {...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'};

/** A nonzero negative run counts only when its intended tests actually failed their assertions. */
async function verifyRun(negative) {
  const name = negative ? 'negative' : 'positive';
  const directory = path.join(example, '.e2e', name);
  await rm(directory, {recursive: true, force: true});
  const args = [cli, 'run', '--no-model', '--artifacts', path.join(directory, 'artifacts'), ...(negative ? ['--config', 'e2e.negative.config.ts'] : [])];
  let result;
  try {result = await runProcess({executable: process.execPath, args, cwd: example, env, timeoutMs: 90_000, maxOutputBytes: 1024 * 1024, expectedExitCodes: [negative ? 1 : 0]});}
  catch (error) {
    if (error.result) {process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes);}
    throw error;
  }
  process.stdout.write(result.stdout.bytes); process.stderr.write(result.stderr.bytes);
  if (result.stdout.truncated || result.stderr.truncated) throw new Error('Runner output exceeded its capture budget');
  const document = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
  const results = validateLanguageReport(document, negative);
  return {results, report: path.relative(root, path.join(directory, 'report.json')).split(path.sep).join('/')};
}
const positive = await verifyRun(false);
const negative = await verifyRun(true);
const summary = {schemaVersion: 1, qualifiedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, node: process.version, runtimes: manifest.runtimes, positive, negative, plantedCliAndHttpDefectsRejected: true};
await mkdir(path.dirname(summaryFile), {recursive: true});
await writeFile(summaryFile, JSON.stringify(summary, null, 2) + '\n');
process.stdout.write('Python, C# and Rust CLI/HTTP verification passed, including all six planted failures.\n');
completed = true;
