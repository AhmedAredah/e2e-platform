import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { run } from '@e2e-cpp/core/runner';
import { terminal } from '../src/engine/terminal.ts';

test('public runner records PTY fixture steps and deterministic screen assertions without a model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-terminal-runner-'));
  vi.stubEnv('E2E_TELEMETRY_DISABLED', '1');
  try {
    const testModule = new URL('../dist/index.js', import.meta.url).href;
    const coreModule = new URL('../../e2e/dist/index.js', import.meta.url).href;
    const file = join(directory, 'terminal.e2e.ts');
    await writeFile(file, `import {test} from ${JSON.stringify(testModule)};\nimport {expect} from ${JSON.stringify(coreModule)};\ntest('native terminal',async({terminal,screen})=>{await terminal.waitFor('READY');await terminal.write('x');await expect(screen.getByText('KEY:x')).toBeVisible();});\n`);
    const program = `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('READY\\r\\n');process.stdin.on('data',d=>process.stdout.write('\\r\\nKEY:'+d.toString()));`;
    const result = await run({
      cwd: directory, files: [file], quiet: true,
      rawConfig: {
        tests: ['*.e2e.ts'],
        targets: [{ name: 'terminal', engine: terminal({ columns: 40, rows: 8 }), app: { appPath: process.execPath, launchArguments: ['-e', program] } }],
        workers: 1, retries: 0, timeout: 5000,
        cache: 'off', modelPolicy: 'forbid',
      },
    });
    expect(result.exitCode, JSON.stringify(result.report.run.errors)).toBe(0);
    expect(result.status).toBe('passed');
    expect(result.reportPath).toBeDefined();
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test('public runner fails a real PTY output overflow after the final terminal operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-terminal-late-fault-'));
  vi.stubEnv('E2E_TELEMETRY_DISABLED', '1');
  try {
    const testModule = new URL('../dist/index.js', import.meta.url).href;
    const file = join(directory, 'terminal.e2e.ts');
    await writeFile(file, `import {test} from ${JSON.stringify(testModule)};
test('late terminal fault',async({terminal})=>{
  await terminal.waitFor('READY');
  await terminal.write('go');
  await new Promise(resolve=>setTimeout(resolve,400));
});\n`);
    const program = `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('READY\\r\\n');process.stdin.once('data',()=>setTimeout(()=>process.stdout.write('X'.repeat(100)),50));`;
    const result = await run({
      cwd: directory, files: [file], quiet: true,
      rawConfig: {
        tests: ['*.e2e.ts'],
        targets: [{ name: 'terminal', engine: terminal({ maxOutputBytes: 30 }), app: { appPath: process.execPath, launchArguments: ['-e', program] } }],
        workers: 1, retries: 0, timeout: 5000,
        cache: 'off', modelPolicy: 'forbid',
      },
    });
    expect(result.exitCode).toBe(3);
    expect(result.status).toBe('error');
    expect(JSON.stringify(result.report.run.results)).toContain('ENGINE_FAILURE');
    expect(JSON.stringify(result.report.run.results)).toContain('Terminal output exceeded its configured byte budget');
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
