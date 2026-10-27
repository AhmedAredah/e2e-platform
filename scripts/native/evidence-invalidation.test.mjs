import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const execute = promisify(execFile);
for (const scenario of [
  { script: 'verify-desktop-consumer.mjs', helpers: ['completion-guard.mjs', 'cmake-targets.mjs', 'verification-report.mjs'], summary: `.e2e/desktop-consumer/${{linux:'linux-atspi',win32:'windows-uia',darwin:'macos-ax'}[process.platform]}/qualification.json`, args: ['--invalid'] },
  { script: 'install-kit-smoke.mjs', helpers: ['package-manager.mjs'], summary: '.e2e/cpp/install-kit-smoke-summary.json', args: ['--invalid'] },
  { script: 'qt-export-proof.mjs', helpers: ['completion-guard.mjs', 'verified-screenshot.mjs', 'cmake-targets.mjs'], summary: '.e2e/cpp/qt-exports/qt-export-proof.json', args: [] },
]) {
  test(`${scenario.script} invalidates previous success before failing prerequisites`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'e2e-stale-evidence-'));
    try {
      const scripts = join(directory, 'scripts/native'); await mkdir(scripts, { recursive: true });
      for (const name of [scenario.script, ...scenario.helpers]) await copyFile(new URL(name, import.meta.url), join(scripts, name));
      const summary = join(directory, scenario.summary); await mkdir(dirname(summary), { recursive: true });
      await writeFile(summary, JSON.stringify({ passed: true }));
      await assert.rejects(execute(process.execPath, [join(scripts, scenario.script), ...scenario.args], { timeout: 10_000 }));
      await assert.rejects(readFile(summary), { code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
