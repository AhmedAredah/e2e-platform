/** Retains a native backtrace after a failing macOS Qt gate; never changes its verdict. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
import { QtCrashReportCollector } from './qt-crash-reports.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Qt crash diagnostics require macOS');
const output = join(root, '.e2e/cpp/qt-crash');
mkdirSync(output, { recursive: true });
const collector = new QtCrashReportCollector(join(output, 'system-reports'));
const reports = collector.collect([join(homedir(), 'Library/Logs/DiagnosticReports'), '/Library/Logs/DiagnosticReports']);
writeFileSync(join(output, 'system-reports.json'), `${JSON.stringify(reports, null, 2)}\n`);
// Preserve the original fixture's crash report before running a different
// diagnostic executable, which cannot prove the original crash is resolved.
const executable = requireExecutableTarget(configuredExecutables(join(root, 'examples/with-qt/build')), 'e2e_qt_quick_controls_tests');
const result = spawnSync('lldb', ['--batch', '-o', 'run', '-k', 'thread backtrace all', '--', executable, 'accessibleRolesAndFlickableScrollingUsePublicQtInterfaces'], {
  env: process.env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
writeFileSync(join(output, 'quick-lldb.txt'), `${result.stdout ?? ''}\n${result.stderr ?? ''}\nDebugger status: ${result.status}; signal: ${result.signal}; error: ${result.error?.code ?? 'none'}\n`);
