import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execute = promisify(execFile);

/** Exercises discovery, per-case child ownership and report verdicts through the real CLI. */
async function run(body: string, discovery: unknown = { protocol: 1, tests: ['compiled case'] }): Promise<{ code: number; report: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-cpp-host-'));
  try {
    const executable = join(directory, 'compiled-test.mjs');
    await writeFile(executable, `if (process.argv.includes('--e2e-list')) { console.log(${JSON.stringify(JSON.stringify(discovery))}); } else { ${body} }`);
    await writeFile(join(directory, 'tests.e2e.ts'), `import { registerCppTests } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
await registerCppTests({ executable: process.execPath, args: [${JSON.stringify(executable)}], timeoutMs: 2000 });`);
    await writeFile(join(directory, 'e2e.config.ts'), `export default { tests: ['*.e2e.ts'], modelPolicy: 'forbid', workers: 1, retries: 0, targets: [{name:'cpp',platform:'test'}] };`);
    const result = await execute(process.execPath, [fileURLToPath(new URL('../../e2e/dist/cli/bin.js', import.meta.url)), 'run', '--no-model'], { cwd: directory, timeout: 15_000, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' } }).then(() => 0, (cause: unknown) => (cause as { code: number }).code);
    return { code: result, report: await readFile(join(directory, '.e2e/report.json'), 'utf8') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('records a compiled-case assertion and permits ordinary diagnostics on stderr', async () => {
  const result = await run(`process.stderr.write('private diagnostic');
process.stdout.write(JSON.stringify({protocol:1,id:1,method:'expect.equal',params:{actual:42,expected:42}})+'\\n');
process.stdin.once('data', data => { const reply=JSON.parse(data); process.exit(reply.result===null ? 0 : 1); });`);
  expect(result.code, result.report).toBe(0);
  expect(result.report).toContain('C++ equality assertion');
  expect(result.report).not.toContain('private diagnostic');
});

test('a failed C++ assertion produces a failed case without exposing values', async () => {
  const result = await run(`process.stdout.write(JSON.stringify({protocol:1,id:1,method:'expect.equal',params:{actual:'private actual',expected:'private expected'}})+'\\n');
process.stdin.once('data', data => { const reply=JSON.parse(data); process.exit(reply.error ? 1 : 0); });`);
  expect(result.code).toBe(1);
  expect(result.report).toContain('C++ equality assertion failed');
  expect(result.report).not.toContain('private actual');
});

test.each([
  `process.stdout.write('x'.repeat(1024*1024+1));`,
  `process.stdout.write('{"protocol":1');`,
  `process.stdout.write(JSON.stringify({protocol:1,id:1,method:'expect.true',params:{actual:true}})+'\\n'+JSON.stringify({protocol:1,id:2,method:'expect.true',params:{actual:true}})+'\\n'); process.stdin.resume();`,
  `process.stdout.write(JSON.stringify({protocol:1,id:1,method:'expect.true',params:{actual:true}})+'\\n'); process.stdin.on('data',()=>process.stdout.write(JSON.stringify({protocol:1,id:1,method:'expect.true',params:{actual:true}})+'\\n'));`,
])('malformed, pipelined and duplicate-ID clients fail closed', async body => {
  const result = await run(body);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.report).run.summary.passed).toBe(0);
});

test('a hanging compiled test is bounded by the attempt deadline', async () => {
  const result = await run(`setInterval(()=>{}, 1000);`);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.report).run.summary.passed).toBe(0);
});

test.each([
  { method: 'expect.true', params: { actual: false }, exit: 1 },
  { method: 'app.open', params: {}, exit: 2 },
  { method: 'unsupported.operation', params: {}, exit: 1 },
])('a client cannot ignore a failed operation and claim success', async ({ exit, ...request }) => {
  const result = await run(`process.stdout.write(${JSON.stringify(JSON.stringify({ protocol: 1, id: 1, ...request }) + '\n')}); process.stdin.once('data',()=>process.exit(0));`);
  expect(result.code).toBe(exit);
  expect(JSON.parse(result.report).run.summary.passed).toBe(0);
});
