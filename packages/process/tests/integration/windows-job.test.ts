import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessError, ProcessWorkspace, WindowsJobProcessRunner } from '../../src/index.ts';
import type { ProcessOptions, ProcessSession } from '../../src/index.ts';

const fixture = fileURLToPath(new URL('../fixtures/windows-job-helper.mjs', import.meta.url));
const sessions: ProcessSession[] = [];
const directories: string[] = [];

function runner(mode = 'normal'): WindowsJobProcessRunner {
  return new WindowsJobProcessRunner({ executable: process.execPath, args: [fixture, mode], launchTimeoutMs: 2000, shutdownTimeoutMs: 250 });
}
function node(code: string, options: Partial<ProcessOptions> = {}): ProcessOptions {
  return { executable: process.execPath, args: ['-e', code], timeoutMs: 5000, ...options };
}
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'e2e-job-protocol-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(sessions.splice(0).map(session => session.stop()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('Windows supervisor client portable wire contract (not native Job Object qualification)', () => {
  it('preserves exact arguments, cwd and isolated case-insensitive environment', async () => {
    const cwd = await directory();
    vi.stubEnv('E2E_AMBIENT', 'omitted');
    const args = ['space value', '$(echo bad)', '日本語', 'quote"', 'tail\\'];
    const result = await runner().run({ ...node('process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env}))'), args: ['-e', 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env}))', '--', ...args], cwd, inheritEnv: false, env: { E2e_Only: 'kept' } });
    const value = JSON.parse(result.stdout.bytes.toString()) as { args: string[]; cwd: string; env: Record<string, string> };
    expect(value.args).toEqual(args);
    expect(value.cwd).toBe(cwd);
    expect(value.env.E2E_ONLY).toBe('kept');
    expect(value.env.E2E_AMBIENT).toBeUndefined();
    expect(result.ioError).toBeUndefined();
  });

  it('writes chunked binary input with acknowledgement backpressure and drains both full logs', async () => {
    const cwd = await directory();
    const input = Buffer.alloc(200_003, 255);
    const result = await runner().run(node('const b=[];process.stdin.on("data",x=>b.push(x));process.stdin.on("end",()=>{process.stdout.write(Buffer.concat(b));process.stderr.write(Buffer.alloc(90001,128))})', { cwd, stdin: input, maxOutputBytes: 17, stdoutPath: 'stdout.bin', stderrPath: 'stderr.bin' }));
    expect(result.stdout).toEqual({ bytes: Buffer.alloc(17, 255), totalBytes: input.length, truncated: true });
    expect(result.stderr).toEqual({ bytes: Buffer.alloc(17, 128), totalBytes: 90_001, truncated: true });
    expect((await readFile(join(cwd, 'stdout.bin'))).equals(input)).toBe(true);
    expect((await readFile(join(cwd, 'stderr.bin'))).equals(Buffer.alloc(90_001, 128))).toBe(true);
  });

  it('enforces nonzero exits while accepting explicitly expected codes', async () => {
    await expect(runner().run(node('process.exit(7)'))).rejects.toMatchObject({ code: 'PROCESS_EXIT_FAILED', result: { exitCode: 7 } });
    expect((await runner().run({ ...node('process.exit(7)'), expectedExitCodes: [7] })).exitCode).toBe(7);
  });

  it('accepts confirmed completion when an EOF acknowledgement is lost', async () => {
    expect((await runner('lost-eof').run(node('process.stdout.write("done")'))).stdout.bytes.toString()).toBe('done');
  });

  it('accepts stop acknowledgement after final exit and stops idempotently', async () => {
    const session = await runner('ack-after-exit').start(node('setInterval(()=>{},1000)'));
    sessions.push(session);
    const result = await session.stop();
    expect(result.status).toBe('stopped');
    expect(result.ioError).toBeUndefined();
    expect(await session.stop()).toBe(result);
  });

  it('enforces lifetime timeout and caller cancellation', async () => {
    await expect(runner().run(node('setInterval(()=>{},1000)', { timeoutMs: 200 }))).rejects.toMatchObject({ code: 'PROCESS_TIMED_OUT', result: { status: 'timed-out' } });
    const controller = new AbortController();
    const session = await runner().start(node('setInterval(()=>{},1000)', { signal: controller.signal }));
    sessions.push(session);
    controller.abort();
    expect((await session.result).status).toBe('aborted');
  });

  it.each(['malformed', 'oversized', 'binary', 'unconfirmed', 'disagree'])('rejects %s protocol data without treating it as confirmed cleanup', async mode => {
    const failure = await runner(mode).run(node('process.exit(0)')).catch((cause: unknown) => cause);
    const errors = failure instanceof AggregateError ? failure.errors : [failure];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every(error => error instanceof ProcessError)).toBe(true);
  });

  it('interrupts a blocked initial-input write without hanging process completion', async () => {
    await expect(runner().run(node('setInterval(()=>{},1000)', { stdin: Buffer.alloc(2_000_000), timeoutMs: 500 }))).rejects.toMatchObject({ code: 'PROCESS_TIMED_OUT' });
  });

  it('rejects concurrent writes and reports subscriber failures', async () => {
    const session = await runner().start(node('process.stdin.on("data", x => process.stdout.write(x));process.stdin.on("end",()=>{})'));
    sessions.push(session);
    const first = session.write('a');
    await expect(session.write('b')).rejects.toMatchObject({ code: 'PROCESS_IO_FAILED' });
    await first;
    session.onOutput(() => { throw new Error('private subscriber details'); });
    await session.write('c').catch(() => undefined);
    const result = await session.result;
    expect(result.ioError).toBeInstanceOf(ProcessError);
    expect(String(result.ioError)).not.toContain('private subscriber details');
  });

  it('does not echo supervisor failure payloads in errors', async () => {
    const error = await runner('error').start(node('process.exit(0)')).catch(cause => cause as Error);
    expect(error).toBeInstanceOf(ProcessError);
    expect(String(error)).not.toContain('sensitive helper payload');
  });

  it('retains workspace state when a started helper never confirms startup cleanup', async () => {
    const workspace = await ProcessWorkspace.create(runner('malformed'));
    directories.push(workspace.directory);
    await expect(workspace.start(node('process.exit(0)'))).rejects.toMatchObject({ code: 'PROCESS_IO_FAILED', result: { ioError: expect.any(ProcessError) } });
    await expect(workspace.dispose()).rejects.toThrow('cleanup failed');
  });

  it('bounds stalled startup and fails an unavailable helper without fallback', async () => {
    const stalled = new WindowsJobProcessRunner({ executable: process.execPath, args: [fixture, 'stall'], launchTimeoutMs: 100, shutdownTimeoutMs: 100 });
    await expect(stalled.start(node('process.exit(0)'))).rejects.toMatchObject({ code: 'PROCESS_TIMED_OUT' });
    const missing = new WindowsJobProcessRunner({ executable: join(await directory(), 'missing-supervisor'), shutdownTimeoutMs: 100 });
    await expect(missing.start(node('process.exit(0)'))).rejects.toMatchObject({ code: 'PROCESS_SPAWN_FAILED' });
    await expect(runner('abrupt').start(node('process.exit(0)'))).rejects.toMatchObject({ code: 'PROCESS_SPAWN_FAILED' });
  });

  it('validates explicit helper and target paths and bounded protocol options before launch', async () => {
    expect(() => new WindowsJobProcessRunner({ executable: 'implicit-helper' })).toThrow('absolute');
    await expect(runner().start({ executable: 'implicit-target' })).rejects.toThrow('absolute');
    await expect(runner().start(node('', { drainTimeoutMs: 30_001 }))).rejects.toThrow('drainTimeoutMs');
    await expect(runner().start(node('', { env: { BAD: '\0' } }))).rejects.toThrow('environment');
    await expect(runner().start(node('', { args: ['x'.repeat(128 * 1024)] }))).rejects.toThrow('frame limit');
  });
});
