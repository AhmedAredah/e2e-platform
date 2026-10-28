import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execute = promisify(execFile);
const interpreter = process.env.E2E_TEST_PYTHON;

/** Runs real installed Python/pytest against the shared CLI, including final report verdicts. */
async function run(source: string, plugins: string[] = []): Promise<{ code: number; report: string }> {
  if (!interpreter) throw new Error('Set E2E_TEST_PYTHON to an interpreter with the Python SDK installed');
  const directory = await mkdtemp(path.join(tmpdir(), 'e2e-python-'));
  try {
    await writeFile(path.join(directory, 'test_cases.py'), source);
    await writeFile(path.join(directory, 'python.e2e.ts'), `import { registerPythonTests } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};\nawait registerPythonTests({ interpreter: ${JSON.stringify(interpreter)}, cwd: ${JSON.stringify(directory)}, tests: ['test_cases.py'], plugins: ${JSON.stringify(plugins)}, timeoutMs: 3500 });`);
    await writeFile(path.join(directory, 'e2e.config.ts'), `export default { tests: ['*.e2e.ts'], modelPolicy: 'forbid', workers: 1, retries: 0, targets: [{ name: 'python', platform: 'process' }] };`);
    const code = await execute(process.execPath, [fileURLToPath(new URL('../../e2e/dist/cli/bin.js', import.meta.url)), 'run', '--no-model'], { cwd: directory, timeout: 20_000, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' } }).then(() => 0, (error: unknown) => (error as { code: number }).code);
    return { code, report: await readFile(path.join(directory, '.e2e/report.json'), 'utf8') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test.skipIf(!interpreter)('pytest parametrization and yield fixtures execute through separate reported cases', async () => {
  const result = await run(`import pytest\nfrom decimal import Decimal\n@pytest.fixture\ndef value():\n    yield Decimal('1.0000000000000001')\n@pytest.mark.parametrize('value2', [1, 2])\ndef test_exact(e2e, value, value2):\n    print('ordinary Python diagnostic')\n    e2e.expect_equal(value, Decimal('1.0000000000000001'))\n    e2e.expect_equal(18446744073709551615, 18446744073709551615)\n`);
  expect(result.code, result.report).toBe(0);
  expect(JSON.parse(result.report).run.summary.passed).toBe(2);
});

test.skipIf(!interpreter)('Python binary process I/O and owned readiness work with real processes', async () => {
  const result = await run(`import sys\ndef test_process(e2e):\n    result=e2e.processes.run(sys.executable, ['-c', 'import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'], stdin=bytes([0,128,255]))\n    assert result.stdout == bytes([0,128,255])\n    with e2e.processes.start(sys.executable, ['-u','-c', 'import time;print("READY",flush=True);time.sleep(60)']) as child:\n        assert 'READY' in child.wait_for_output('READY')\n`);
  expect(result.code, result.report).toBe(0);
});

test.skipIf(!interpreter).each([
  `def test_failure(e2e):\n    try: e2e.expect_equal(9007199254740993,9007199254740992)\n    except Exception: pass\n`,
  `def test_failure(e2e):\n    try: e2e.expect_equal(float('nan'),0)\n    except Exception: pass\n`,
  `def test_failure():\n    import os\n    os._exit(0)\n`,
  `import pytest\n@pytest.fixture\ndef broken():\n    yield 1\n    assert False\ndef test_failure(broken): pass\n`,
  `def test_failure():\n    import time\n    time.sleep(60)\n`,
])('Python cannot report success after a failed or incomplete case: %s', async source => {
  const result = await run(source);
  expect(result.code, result.report).toBe(1);
  expect(JSON.parse(result.report).run.summary.passed).toBe(0);
});

test.skipIf(!interpreter)('pytest skip is recorded as skipped and unexpected xpass fails', async () => {
  const skipped = await run(`import pytest\n@pytest.mark.skip(reason='fixture unavailable')\ndef test_optional(): pass\n`);
  expect(skipped.code, skipped.report).toBe(0);
  expect(JSON.parse(skipped.report).run.summary.passed).toBe(0);
  const xpass = await run(`import pytest\n@pytest.mark.xfail\ndef test_unexpected(): pass\n`);
  expect(xpass.code, xpass.report).toBe(1);
});

test.skipIf(!interpreter)('service readiness waits for a complete split UTF-8 announcement', async () => {
  const result = await run(`import sys\ndef test_service(e2e):\n    program='import sys,time;sys.stdout.buffer.write(b"READY caf"+bytes([195]));sys.stdout.flush();time.sleep(0.05);sys.stdout.buffer.write(bytes([169,32,49,50,51,10]));sys.stdout.flush();time.sleep(60)'\n    with e2e.processes.start_service(sys.executable, ['-u','-c',program], ready_text='READY ') as service:\n        assert service.ready_output == 'READY café 123\\n'\n`);
  expect(result.code, result.report).toBe(0);
});

test.skipIf(!interpreter)('a service crash after readiness cannot pass the test', async () => {
  const result = await run(`import sys,time\ndef test_crash(e2e):\n    with e2e.processes.start_service(sys.executable, ['-u','-c','import time;print("READY",flush=True);time.sleep(0.1);raise SystemExit(3)'], ready_text='READY'):\n        time.sleep(0.3)\n`);
  expect(result.code, result.report).toBe(1);
  expect(JSON.parse(result.report).run.summary.passed).toBe(0);
});

test.skipIf(!interpreter)('service readiness timeout retains a useful shared failure instead of an incomplete-exit message', async () => {
  const result = await run(`import sys\ndef test_readiness(e2e):\n    e2e.processes.start_service(sys.executable,['-c','import time;time.sleep(60)'],ready_text='READY',startup_timeout_ms=100)\n`);
  expect(result.code, result.report).toBe(1);
  expect(result.report).toContain('Process readiness deadline exceeded');
});

test.skipIf(!interpreter)('explicit pytest asyncio plugin and async yield fixture use the same runner', async () => {
  const result = await run(`import pytest,pytest_asyncio\n@pytest_asyncio.fixture\nasync def answer():\n    yield 42\n@pytest.mark.asyncio\nasync def test_async(e2e,answer):\n    await e2e.run_async(e2e.expect_equal,answer,42)\n`, ['pytest_asyncio.plugin']);
  expect(result.code, result.report).toBe(0);
});
