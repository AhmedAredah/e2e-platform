import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { run } from '@e2e-platform/core/runner';
import { terminal } from '../src/engine/terminal.ts';

/** Stops the fixture if a failed run could not reach normal engine cleanup. */
async function stopFixture(pidFile: string): Promise<void> {
  const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
  if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid) {
    try { process.kill(pid, 'SIGKILL'); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
  }
}

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
  const pidFile = join(directory, 'terminal.pid');
  const triggerFile = join(directory, 'overflow');
  vi.stubEnv('E2E_TELEMETRY_DISABLED', '1');
  try {
    const testModule = new URL('../dist/index.js', import.meta.url).href;
    const file = join(directory, 'terminal.e2e.ts');
    await writeFile(file, `import {test} from ${JSON.stringify(testModule)};
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('late terminal fault',async({terminal})=>{
  await terminal.waitFor('READY');
  await terminal.write('go');
  const pid=Number(await readFile(${JSON.stringify(pidFile)},'utf8'));
  await writeFile(${JSON.stringify(triggerFile)},'start');
  const deadline=Date.now()+5000;
  for(;;){
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')break;throw error;}
    if(Date.now()>=deadline)throw new Error('The overflowing terminal child was not stopped');
    await delay(20);
  }
});\n`);
    const program = `
const fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('READY\\r\\n');
let input='',sequence=0;
process.stdin.on('data',data=>{input+=data.toString();});
setInterval(()=>{
  if(!input.includes('go')||!fs.existsSync(${JSON.stringify(triggerFile)}))return;
  const line=Array.from({length:256},(_,index)=>String.fromCharCode(33+(index+sequence)%90)).join('');
  sequence++;
  process.stdout.write((line+'\\r\\n').repeat(8));
},5);
`;
    const result = await run({
      cwd: directory, files: [file], quiet: true,
      rawConfig: {
        tests: ['*.e2e.ts'],
        // Raw ConPTY startup includes control sequences; exhaust the budget only after the handshake.
        targets: [{ name: 'terminal', engine: terminal({ maxOutputBytes: 16 * 1024 }), app: { appPath: process.execPath, launchArguments: ['-e', program] } }],
        workers: 1, retries: 0, timeout: 10_000,
        cache: 'off', modelPolicy: 'forbid',
      },
    });
    expect(result.exitCode, JSON.stringify(result.report.run.results)).toBe(3);
    expect(result.status).toBe('error');
    const attempt = result.report.run.results.find((item) => item.kind === 'test')?.attempts[0];
    expect(attempt?.steps.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: 'terminal.waitFor', status: 'passed' },
      { label: 'terminal.write', status: 'passed' },
    ]);
    expect(attempt?.error).toMatchObject({ code: 'ENGINE_FAILURE', message: 'Terminal output exceeded its configured byte budget' });
    expect(attempt?.cleanup).toBe('complete');
    expect(attempt?.secondaryErrors ?? []).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    try { await stopFixture(pidFile); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}, 20_000);
