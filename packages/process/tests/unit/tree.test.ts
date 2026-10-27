import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTree } from '../../src/tree.ts';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const ownedPid = 424242;
const denied = () => Object.assign(new Error('permission denied'), { code: 'EPERM' });
const gone = () => Object.assign(new Error('no group'), { code: 'ESRCH' });

beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  vi.spyOn(process, 'kill').mockReturnValue(true);
  vi.mocked(delay).mockClear();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
});

describe('owned process-group termination', () => {
  it('yields for a Darwin zombie group and requires confirmed disappearance', async () => {
    vi.mocked(process.kill).mockImplementationOnce(() => { throw denied(); })
      .mockImplementationOnce(() => { throw gone(); });
    await expect(terminateProcessTree(ownedPid, { graceMs: 35 })).resolves.toBeUndefined();
    expect(process.kill).toHaveBeenCalledTimes(2);
    expect(process.kill).toHaveBeenNthCalledWith(1, -ownedPid, 'SIGTERM');
    expect(process.kill).toHaveBeenNthCalledWith(2, -ownedPid, 'SIGTERM');
    expect(delay).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('preserves escalation and its grace interval after a transient Darwin error', async () => {
    vi.mocked(process.kill).mockImplementationOnce(() => { throw denied(); });
    await terminateProcessTree(ownedPid, { graceMs: 35 });
    expect(vi.mocked(process.kill).mock.calls).toEqual([
      [-ownedPid, 'SIGTERM'], [-ownedPid, 'SIGTERM'], [-ownedPid, 'SIGKILL'],
    ]);
    expect(vi.mocked(delay).mock.calls).toEqual([[10], [35]]);
  });

  it('also requires confirmation when a Darwin group becomes zombies during escalation', async () => {
    vi.mocked(process.kill).mockReturnValueOnce(true)
      .mockImplementationOnce(() => { throw denied(); })
      .mockImplementationOnce(() => { throw gone(); });
    await terminateProcessTree(ownedPid, { graceMs: 0 });
    expect(vi.mocked(process.kill).mock.calls).toEqual([
      [-ownedPid, 'SIGTERM'], [-ownedPid, 'SIGKILL'], [-ownedPid, 'SIGKILL'],
    ]);
    expect(delay).toHaveBeenCalledExactlyOnceWith(10);
  });

  it.each(['SIGTERM', 'SIGKILL'] as const)('never hides a persistent Darwin permission failure during %s', async (stage) => {
    const failure = denied();
    vi.mocked(process.kill).mockImplementation((_pid, signal) => {
      if (signal === stage) throw failure;
      return true;
    });
    await expect(terminateProcessTree(ownedPid, { graceMs: 0 })).rejects.toMatchObject({
      code: 'PROCESS_CLEANUP_FAILED', cause: failure,
    });
    expect(vi.mocked(process.kill).mock.calls.filter(([, signal]) => signal === stage)).toHaveLength(11);
    expect(delay).toHaveBeenCalledTimes(10);
    expect(vi.mocked(process.kill).mock.calls.every(([pid]) => pid === -ownedPid)).toBe(true);
  });

  it('does not retry permission errors on other platforms', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const failure = denied();
    vi.mocked(process.kill).mockImplementation(() => { throw failure; });
    await expect(terminateProcessTree(ownedPid)).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED', cause: failure });
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(-ownedPid, 'SIGTERM');
    expect(delay).not.toHaveBeenCalled();
  });

  it.each([0, 1, -ownedPid, process.pid])('rejects an unsafe ownership target %s before signaling', async (pid) => {
    await expect(terminateProcessTree(pid)).rejects.toBeInstanceOf(TypeError);
    expect(process.kill).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });
});
