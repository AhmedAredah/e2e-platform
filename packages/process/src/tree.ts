import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProcessError } from './error.ts';

/** Signals an owned POSIX process group; ESRCH means cleanup has already completed. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try { process.kill(-pid, signal); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Terminates an owned process tree. On POSIX pid MUST be its process-group leader,
 * as created by startProcess. Windows uses taskkill /T /F and requires a live root.
 * This is cleanup, not a security sandbox; escaped groups/Windows breakaways are not contained.
 */
export async function terminateProcessTree(pid: number, options: { graceMs?: number } = {}): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new TypeError('pid must identify an owned child process group');
  const graceMs = options.graceMs ?? 500;
  if (!Number.isFinite(graceMs) || graceMs < 0 || graceMs > 2_147_483_647) throw new TypeError('graceMs must be a finite nonnegative timer duration');
  try {
    if (process.platform === 'win32') {
      const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
      await new Promise<void>((resolve, reject) => {
        execFile(join(root, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, (error) => {
          if (!error) { resolve(); return; }
          try { process.kill(pid, 0); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { resolve(); return; } }
          reject(error);
        });
      });
      return;
    }
    if (!signalGroup(pid, 'SIGTERM')) return;
    if (graceMs > 0) await delay(graceMs);
    signalGroup(pid, 'SIGKILL');
  } catch (cause) {
    throw new ProcessError('PROCESS_CLEANUP_FAILED', `Could not terminate process tree ${pid}`, { cause });
  }
}
