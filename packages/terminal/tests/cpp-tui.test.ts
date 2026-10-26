import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TerminalSession } from '../src/model/session.ts';
import { NodePtyTransport } from '../src/transport/node-pty.ts';

const compiler = process.env.CXX ?? 'c++';
let hasCompiler = process.platform !== 'win32';
if (hasCompiler) {
  try { execFileSync(compiler, ['--version'], { stdio: 'ignore', timeout: 5000 }); }
  catch { hasCompiler = false; }
}
describe.skipIf(!hasCompiler)('compiled C++ TUI through the PTY', () => {
  let directory: string;
  let executable: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'e2e-platform-terminal-'));
    executable = join(directory, 'menu');
    execFileSync(compiler, ['-std=c++17', fileURLToPath(new URL('./fixtures/menu.cpp', import.meta.url)), '-o', executable], { timeout: 30_000, stdio: 'pipe' });
  });
  afterAll(async () => { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); });
  test('changes the native application state and verifies its current screen after erase/redraw', async () => {
    const terminal = await TerminalSession.create((dimensions) => NodePtyTransport.create({ executable }, dimensions), { columns: 60, rows: 8 });
    try {
      await terminal.waitFor('Count: 0', { timeoutMs: 5000 });
      await terminal.write('1');
      await terminal.press('Enter');
      const incremented = await terminal.waitFor('Count: 1');
      expect(incremented.text).not.toContain('Count: 0');
      await terminal.write('2\r');
      const reset = await terminal.waitFor('Count: 0');
      expect(reset.text).not.toContain('Count: 1');
      await terminal.write('q\r');
      await terminal.waitFor('Goodbye');
    } finally { await terminal.close(); }
  });
});
