import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalProcessRunner, ProcessError, ProcessRunner, ProcessWorkspace, runProcess, startProcess, terminateProcessTree } from '../../src/index.ts';
import type { ProcessOptions, ProcessSession, RunProcessOptions, ProcessResult } from '../../src/index.ts';

const temporary: string[] = [];
const sessions: ProcessSession[] = [];
const execute = promisify(execFile);

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'e2e-process-test-'));
  temporary.push(path);
  return path;
}

function node(code: string, options: Partial<ProcessOptions> = {}): ProcessOptions {
  return { executable: process.execPath, args: ['-e', code], ...options };
}

async function until(read: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!read()) { if (Date.now() >= deadline) throw new Error('Condition was never reached'); await delay(10); }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(sessions.splice(0).map((session) => session.stop()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('finite process contracts', () => {
  it('completes in a standalone controller with no test-runner event-loop handles', async () => {
    const cwd = await directory();
    const output = join(cwd, 'compiled');
    const compiler = fileURLToPath(new URL('./bin/tsc', import.meta.resolve('typescript/package.json')));
    await execute(process.execPath, [compiler, '--project', fileURLToPath(new URL('../../tsconfig.build.json', import.meta.url)), '--outDir', output], { timeout: 15_000 });
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
    const controller = join(cwd, 'controller.mjs');
    await writeFile(controller, `
import { LocalProcessRunner, ProcessRunner, runProcess } from ${JSON.stringify(pathToFileURL(join(output, 'index.js')).href)};
let complete = false;
process.once('beforeExit', () => { if (!complete) { process.stderr.write('CONTROLLER_LEFT_UNSETTLED\\n'); process.exitCode = 91; } });
for (let i = 0; i < 20; i++) {
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'require("node:fs").closeSync(0);process.stdout.write("finished")'], timeoutMs: 2000 });
  if (result.stdout.bytes.toString() !== 'finished') throw new Error('Output was not fully drained');
}
// A terminal result must win even if a supervisor loses its EOF acknowledgement.
class LostEofAcknowledgement extends ProcessRunner {
  async start(options) {
    const child = await new LocalProcessRunner().start(options);
    return { ...child, closeInput: () => new Promise(() => {}) };
  }
}
await new LostEofAcknowledgement().run({ executable: process.execPath, args: ['-e', 'process.stdout.write("last")'], timeoutMs: 2000 });
complete = true;
process.stdout.write('CONTROLLER_COMPLETED\\n');
`);
    const result = await execute(process.execPath, [controller], { timeout: 15_000 });
    expect(result.stdout).toBe('CONTROLLER_COMPLETED\n');
    expect(result.stderr).not.toContain('CONTROLLER_LEFT_UNSETTLED');
  }, 30_000);

  it('uses exact argument values without evaluating shell syntax', async () => {
    const args = ['a b', '$(echo bad)', '; echo bad', 'quote"', '日本語'];
    const result = await runProcess({ executable: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args] });
    expect(JSON.parse(result.stdout.bytes.toString())).toEqual(args);
    expect(result.status).toBe('exited');
    expect(result.exitCode).toBe(0);
  });

  it('applies cwd and environment overrides/removals without mutating the caller', async () => {
    const cwd = await directory();
    const result = await runProcess(node('process.stdout.write(JSON.stringify({cwd:process.cwd(),value:process.env.E2E_PROCESS_VALUE,missing:process.env.E2E_PROCESS_MISSING}))', { cwd, env: { E2E_PROCESS_VALUE: 'hello', E2E_PROCESS_MISSING: undefined } }));
    const observed = JSON.parse(result.stdout.bytes.toString()) as { cwd: string; value: string };
    expect(observed).toEqual({ cwd: expect.any(String), value: 'hello' });
    expect(await realpath(observed.cwd)).toBe(await realpath(cwd));
    expect(process.env.E2E_PROCESS_VALUE).toBeUndefined();
  });

  it('omits inherited application, search-path and coverage values', async () => {
    vi.stubEnv('E2E_PROCESS_AMBIENT', 'must-not-inherit');
    vi.stubEnv('NODE_V8_COVERAGE', join(await directory(), 'coverage'));
    const result = await runProcess(node('process.stdout.write(JSON.stringify(process.env))', { inheritEnv: false, env: { E2E_PROCESS_ONLY: 'yes' } }));
    const observed = JSON.parse(result.stdout.bytes.toString()) as Record<string, string>;
    expect(observed.E2E_PROCESS_ONLY).toBe('yes');
    expect(observed.E2E_PROCESS_AMBIENT).toBeUndefined();
    expect(observed.NODE_V8_COVERAGE).toBeUndefined();
    expect(observed.PATH).toBe(process.platform === 'win32' ? '' : undefined);
    for (const [key, value] of Object.entries(observed)) {
      if (key === 'E2E_PROCESS_ONLY') continue;
      if (process.platform === 'win32' && key.toUpperCase() === 'SYSTEMROOT') expect(value).toBe(process.env.SYSTEMROOT ?? '');
      else expect(value).toBe('');
    }
  });

  it('does not restore explicitly removed inherited search-path or coverage values', async () => {
    vi.stubEnv('NODE_V8_COVERAGE', join(await directory(), 'coverage'));
    const env = process.platform === 'win32' ? { Path: undefined, node_v8_coverage: undefined } : { PATH: undefined, NODE_V8_COVERAGE: undefined };
    const result = await runProcess(node('process.stdout.write(JSON.stringify({path:process.env.PATH,coverage:process.env.NODE_V8_COVERAGE}))', { env }));
    expect(JSON.parse(result.stdout.bytes.toString())).toEqual(process.platform === 'win32' ? { path: '' } : {});
  });

  it('keeps explicitly supplied search-path values in an isolated environment', async () => {
    const value = join(await directory(), 'explicit search path');
    const result = await runProcess(node('process.stdout.write(process.env.PATH)', { inheritEnv: false, env: { [process.platform === 'win32' ? 'Path' : 'PATH']: value } }));
    expect(result.stdout.bytes.toString()).toBe(value);
  });

  it.runIf(process.platform === 'win32')('preserves SystemRoot from a case-sensitive worker environment', async () => {
    const systemRoot = process.env.SYSTEMROOT;
    if (systemRoot === undefined) throw new Error('The Windows test host must supply SystemRoot');
    const worker = new Worker(`
const { parentPort, workerData } = require('node:worker_threads');
void (async () => {
  const { runProcess } = await import(workerData.module);
  const result = await runProcess({ executable: process.execPath, args: ['-e', 'process.stdout.write(process.env.SYSTEMROOT)'], inheritEnv: false });
  parentPort.postMessage(result.stdout.bytes.toString());
})();
`, { eval: true, env: { SystemRoot: systemRoot }, workerData: { module: new URL('../../dist/index.js', import.meta.url).href } });
    try {
      const [observed] = await once(worker, 'message');
      expect(observed).toBe(systemRoot);
    } finally {
      await worker.terminate();
    }
  });

  it('closes absent stdin and writes provided binary input before EOF', async () => {
    const code = 'const b=[];process.stdin.on("data",x=>b.push(x));process.stdin.on("end",()=>process.stdout.write(Buffer.concat(b)))';
    const empty = await runProcess(node(code));
    expect(empty.stdout.totalBytes).toBe(0);
    const input = Buffer.from([0, 128, 255, 13, 10]);
    const binary = await runProcess(node(code, { stdin: input }));
    expect(binary.stdout.bytes).toEqual(input);
  });

  it('drains both oversized binary streams and saves full logs with bounded memory', async () => {
    const cwd = await directory();
    const size = 2_000_000;
    const result = await runProcess(node(`process.stdout.write(Buffer.alloc(${size},255));process.stderr.write(Buffer.alloc(${size},128))`, { cwd, maxOutputBytes: 17, stdoutPath: 'out.bin', stderrPath: 'err.bin' }));
    expect(result.stdout).toEqual({ bytes: Buffer.alloc(17, 255), totalBytes: size, truncated: true });
    expect(result.stderr).toEqual({ bytes: Buffer.alloc(17, 128), totalBytes: size, truncated: true });
    expect(await readFile(join(cwd, 'out.bin'))).toEqual(Buffer.alloc(size, 255));
    expect(await readFile(join(cwd, 'err.bin'))).toEqual(Buffer.alloc(size, 128));
  });

  it('will not overwrite an existing output log or launch when logging cannot start', async () => {
    const cwd = await directory();
    await writeFile(join(cwd, 'out.log'), 'original');
    await expect(runProcess(node('process.exit(99)', { cwd, stdoutPath: 'out.log' }))).rejects.toMatchObject({ code: 'PROCESS_IO_FAILED' });
    expect(await readFile(join(cwd, 'out.log'), 'utf8')).toBe('original');
  });

  it('distinguishes launch failure from an application exit and preserves failing output', async () => {
    await expect(runProcess({ executable: join(await directory(), 'missing-executable') })).rejects.toMatchObject({ code: 'PROCESS_SPAWN_FAILED', result: undefined });
    await expect(runProcess(node('process.stderr.write("invalid input");process.exitCode=7'))).rejects.toMatchObject({ code: 'PROCESS_EXIT_FAILED', result: { exitCode: 7 } });
    const expected = await runProcess({ ...node('process.stderr.write("invalid input");process.exitCode=7'), expectedExitCodes: [7] });
    expect(expected.stderr.bytes.toString()).toBe('invalid input');
  });

  it('validates options before launch', async () => {
    await expect(runProcess({ executable: process.execPath, timeoutMs: -1 })).rejects.toBeInstanceOf(TypeError);
    await expect(runProcess({ executable: process.execPath, expectedExitCodes: [] })).rejects.toBeInstanceOf(TypeError);
    await expect(startProcess({ executable: process.execPath, maxOutputBytes: Number.NaN })).rejects.toBeInstanceOf(TypeError);
    await expect(terminateProcessTree(0)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('session ownership', () => {
  it('supports live input and streaming output with idempotent EOF', async () => {
    const session = await startProcess(node('process.stdout.write("ready\\n");process.stdin.pipe(process.stdout)'));
    sessions.push(session);
    const chunks: Buffer[] = [];
    const unsubscribe = session.onOutput(({ stream, bytes }) => { if (stream === 'stdout') chunks.push(Buffer.from(bytes)); });
    await until(() => session.stdout.bytes.includes('ready'));
    await session.write(Buffer.from([0, 254]));
    await session.closeInput();
    await session.closeInput();
    const result = await session.result;
    unsubscribe();
    expect(result.stdout.bytes).toEqual(Buffer.concat([Buffer.from('ready\n'), Buffer.from([0, 254])]));
    expect(chunks.length).toBeGreaterThan(0);
    await expect(session.write('late')).rejects.toMatchObject({ code: 'PROCESS_STDIN_CLOSED' });
  });

  it('returns a timeout verdict and captured diagnostics after stopping the child', async () => {
    await expect(runProcess(node('process.stdout.write("working");setInterval(()=>{},100)', { timeoutMs: 150, killGraceMs: 20 }))).rejects.toMatchObject({ code: 'PROCESS_TIMED_OUT', result: { status: 'timed-out' } });
  });

  it('responds to cancellation before launch and during execution', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(startProcess(node('process.exit(0)', { signal: cancelled.signal }))).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    const controller = new AbortController();
    const session = await startProcess(node('setInterval(()=>{},100)', { signal: controller.signal, killGraceMs: 10 }));
    sessions.push(session);
    controller.abort();
    expect((await session.result).status).toBe('aborted');
  });

  it('stops explicitly and reuses the same completion for repeated stops', async () => {
    const session = await startProcess(node('setInterval(()=>{},100)', { killGraceMs: 10 }));
    sessions.push(session);
    const [first, second] = await Promise.all([session.stop(), session.stop()]);
    expect(first).toBe(second);
    expect(first.status).toBe('stopped');
  });

  it.skipIf(process.platform === 'win32')('classifies spontaneous signals and escalates when SIGTERM is ignored', async () => {
    await expect(runProcess(node('process.kill(process.pid,"SIGTERM")'))).rejects.toMatchObject({ code: 'PROCESS_SIGNALED', result: { signal: 'SIGTERM' } });
    const session = await startProcess(node('process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},100)', { killGraceMs: 25 }));
    sessions.push(session);
    await until(() => session.stdout.bytes.includes('ready'));
    expect((await session.stop()).signal).toBe('SIGKILL');
  });

  it.skipIf(process.platform === 'win32')('cleans inherited descendants after the parent exits naturally', async () => {
    const result = await runProcess(node('const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:"inherit"});process.stdout.write(String(child.pid));process.exit(0)', { killGraceMs: 20, timeoutMs: 3000 }));
    expect(result.status).toBe('exited');
    expect(result.durationMs).toBeLessThan(3000);
    expect(Number(result.stdout.bytes.toString())).toBeGreaterThan(1);
  });

  it.skipIf(process.platform === 'win32')('bounds pipes held open by an escaped descendant and reports incomplete cleanup', async () => {
    let escaped = 0;
    try {
      await runProcess(node('const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:"inherit",detached:true});process.stdout.write(String(child.pid));process.exit(0)', { killGraceMs: 10, drainTimeoutMs: 100 }));
      throw new Error('Expected inherited pipe cleanup failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
      escaped = Number((error as ProcessError).result?.stdout.bytes.toString());
    } finally {
      if (escaped > 1) await terminateProcessTree(escaped, { graceMs: 0 });
    }
  });
});

describe('extension and fixture ownership', () => {
  it('shares the finite exit contract with inherited runner implementations', async () => {
    class DelegatingRunner extends ProcessRunner {
      calls = 0;
      override start(options: ProcessOptions): Promise<ProcessSession> { this.calls++; return new LocalProcessRunner().start(options); }
    }
    const runner = new DelegatingRunner();
    const result = await runner.run(node('process.stdout.write("subclass")'));
    expect(result.stdout.bytes.toString()).toBe('subclass');
    expect(runner.calls).toBe(1);
  });

  it('isolates workspace files, stops a long-lived session, and removes its directory', async () => {
    const workspace = await ProcessWorkspace.create();
    const child = await workspace.start(node('setInterval(()=>{},100)', { killGraceMs: 10 }));
    await workspace.run(node('require("node:fs").writeFileSync("created.txt","ok")'));
    expect(await readFile(join(workspace.directory, 'created.txt'), 'utf8')).toBe('ok');
    await workspace.dispose();
    await workspace.dispose();
    expect((await child.result).status).toBe('aborted');
    await expect(access(workspace.directory)).rejects.toThrow();
    expect(() => workspace.run(node('process.exit(0)'))).toThrow('disposed');
  });

  it('waits for unawaited finite commands during workspace disposal', async () => {
    const workspace = await ProcessWorkspace.create();
    const running = workspace.run(node('setInterval(()=>{},100)', { killGraceMs: 10 }));
    await delay(50);
    await workspace.dispose();
    await expect(running).rejects.toBeInstanceOf(ProcessError);
    await expect(access(workspace.directory)).rejects.toThrow();
  });
});

it('inherited finite runner releases a real child when an EOF hook rejects', async () => {
  let child: ProcessSession | undefined;
  class BrokenEofRunner extends LocalProcessRunner {
    override async start(options: ProcessOptions): Promise<ProcessSession> {
      child = await super.start(options);
      return { ...child, closeInput: async () => { throw new Error('EOF hook failed'); } };
    }
  }
  await expect(new BrokenEofRunner().run(node('setInterval(()=>{},100)', { killGraceMs: 10 }))).rejects.toThrow('EOF hook failed');
  expect((await child!.result).status).toBe('stopped');
  expect(() => process.kill(child!.pid, 0)).toThrow();
});

it('workspace retains and reports a detected cleanup failure from a finite run', async () => {
  class CleanupFailureRunner extends LocalProcessRunner {
    override async run(options: RunProcessOptions): Promise<ProcessResult> {
      const result = await super.run(options);
      const cause = new ProcessError('PROCESS_CLEANUP_FAILED', 'backend could not clean up');
      throw new ProcessError('PROCESS_CLEANUP_FAILED', 'finite cleanup failed', { result: { ...result, ioError: cause } });
    }
  }
  const workspace = await ProcessWorkspace.create(new CleanupFailureRunner());
  try {
    await expect(workspace.run(node('process.exit(0)'))).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
    await expect(workspace.dispose()).rejects.toThrow('cleanup failed');
    await expect(access(workspace.directory)).resolves.toBeUndefined();
  } finally { await rm(workspace.directory, { recursive: true, force: true }); }
});
