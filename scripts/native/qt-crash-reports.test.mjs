import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QtCrashReportCollector } from './qt-crash-reports.mjs';

/** Isolates crash-report fixtures and their retained output. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qt-crash-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'input');
  mkdirSync(input);
  return { root, input, output: join(root, 'output') };
}

test('retains only recent Qt fixture reports, excluding unrelated files and links', (t) => {
  const { root, input, output } = fixture(t);
  const name = 'e2e_qt_quick_demo-2026-10-28-123456.ips';
  writeFileSync(join(input, name), 'fixture crash');
  writeFileSync(join(input, 'OtherApp-2026-10-28.crash'), 'unrelated');
  const old = join(input, 'e2e_qt_demo-2026-10-27.crash');
  writeFileSync(old, 'old'); utimesSync(old, 1, 1);
  const outside = join(root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'report'), 'outside');
  // Junction creation is available to ordinary Windows users; directories and
  // links are both ineligible even when named like a fixture report.
  symlinkSync(outside, join(input, 'e2e_qt_demo-2026-10-28.ips'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = new QtCrashReportCollector(output, { sinceMs: Date.now() - 60_000 }).collect([input]);
  assert.deepEqual(result.reports, [{ file: `1-${name}`, bytes: 13 }]);
  assert.equal(readFileSync(join(output, result.reports[0].file), 'utf8'), 'fixture crash');
});

test('enforces per-file, total-size and count bounds while preferring newer reports', (t) => {
  const { input, output } = fixture(t);
  for (const [day, bytes] of [[1, 9], [2, 4], [3, 4], [4, 4]]) {
    const path = join(input, `e2e_qt_demo-2026-10-0${day}.crash`);
    writeFileSync(path, 'x'.repeat(bytes)); utimesSync(path, day, day);
  }
  const result = new QtCrashReportCollector(output, { sinceMs: 0, maxFiles: 2, maxFileBytes: 5, maxTotalBytes: 6 }).collect([input]);
  assert.equal(result.reports.length, 1); assert.equal(result.totalBytes, 4);
  assert.match(result.reports[0].file, /2026-10-04/);
  const limited = new QtCrashReportCollector(output, { sinceMs: 0, maxFiles: 2, maxFileBytes: 5, maxTotalBytes: 20 }).collect([input]);
  assert.equal(limited.reports.length, 2); assert.equal(limited.totalBytes, 8);
});

test('records unavailable crash-report directories without inventing evidence', (t) => {
  const { root, output } = fixture(t);
  const result = new QtCrashReportCollector(output).collect([join(root, 'missing')]);
  assert.deepEqual(result.reports, []);
  assert.deepEqual(result.diagnostics, [{ stage: 'scan', code: 'ENOENT' }]);
});
