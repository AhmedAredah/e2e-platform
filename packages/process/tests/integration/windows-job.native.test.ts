import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WindowsJobProcessRunner, type ProcessSession } from '../../src/index.ts';

const helper = process.env.E2E_WINDOWS_JOB_HELPER;
const fixture = process.env.E2E_WINDOWS_JOB_FIXTURE;
const requested = helper !== undefined || fixture !== undefined;
const sessions: ProcessSession[] = [];

function runner(): WindowsJobProcessRunner {
  return new WindowsJobProcessRunner({ executable: helper!, launchTimeoutMs: 15_000, shutdownTimeoutMs: 10_000 });
}

async function assertDead(pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { process.kill(pid, 0); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw cause;
    }
    if (Date.now() >= deadline) throw new Error('Owned Windows process remains alive after confirmed job cleanup');
    await delay(10);
  }
}

describe.runIf(process.platform === 'win32' && requested)('native Windows supervisor with the actual TypeScript client', () => {
  beforeAll(() => {
    if (helper === undefined || fixture === undefined || !isAbsolute(helper) || !isAbsolute(fixture)) {
      throw new Error('Set E2E_WINDOWS_JOB_HELPER and E2E_WINDOWS_JOB_FIXTURE to absolute published executable paths');
    }
  });
  afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.stop())); });

  it('transports binary input/output with an expected nonzero exit', async () => {
    const input = Buffer.alloc(200_003);
    for (let index = 0; index < input.length; index++) input[index] = index % 256;
    const result = await runner().run({ executable: fixture!, args: ['echo'], stdin: input, expectedExitCodes: [7], timeoutMs: 15_000 });
    expect(result.stdout.bytes.equals(input)).toBe(true);
    expect(result.stderr.bytes).toEqual(Buffer.from([0, 255, 10, 128]));
    expect(result.exitCode).toBe(7);
    expect(result.status).toBe('exited');
    expect(result.ioError).toBeUndefined();
  }, 30_000);

  it('enforces the ordinary exit-code contract', async () => {
    await expect(runner().run({ executable: fixture!, args: ['echo'], timeoutMs: 15_000 })).rejects.toMatchObject({ code: 'PROCESS_EXIT_FAILED', result: { exitCode: 7 } });
  }, 30_000);

  it('cleans a live descendant after natural root exit and drains its inherited pipe', async () => {
    const result = await runner().run({ executable: fixture!, args: ['tree-exit'], expectedExitCodes: [23], timeoutMs: 15_000 });
    const pids = JSON.parse(result.stdout.bytes.toString().trim()) as { rootPid: number; childPid: number };
    expect(pids.rootPid).toBe(result.pid);
    expect(Number.isSafeInteger(pids.childPid)).toBe(true);
    expect(result.status).toBe('exited');
    expect(result.ioError).toBeUndefined();
    await assertDead(pids.rootPid);
    await assertDead(pids.childPid);
  }, 30_000);

  it('stops a running tree with clean status and no transport error', async () => {
    const session = await runner().start({ executable: fixture!, args: ['tree-wait'], timeoutMs: 15_000 });
    sessions.push(session);
    const deadline = Date.now() + 10_000;
    while (!session.stdout.bytes.includes(10)) {
      if (Date.now() >= deadline) throw new Error('Windows process fixture did not report its descendant');
      await delay(10);
    }
    const pids = JSON.parse(session.stdout.bytes.toString().trim()) as { rootPid: number; childPid: number };
    const result = await session.stop();
    expect(result.status).toBe('stopped');
    expect(result.ioError).toBeUndefined();
    await assertDead(pids.rootPid);
    await assertDead(pids.childPid);
    expect(await session.stop()).toBe(result);
  }, 30_000);
});
