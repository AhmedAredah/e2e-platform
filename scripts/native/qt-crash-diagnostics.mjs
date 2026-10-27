/** Retains a native backtrace after a failing macOS Qt gate; never changes its verdict. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredExecutables, requireExecutableTarget } from './cmake-targets.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Qt crash diagnostics require macOS');
const executable = requireExecutableTarget(configuredExecutables(join(root, 'examples/with-qt/build')), 'e2e_qt_quick_controls_tests');
const output = join(root, '.e2e/cpp/qt-crash');
mkdirSync(output, { recursive: true });
const result = spawnSync('lldb', ['--batch', '-o', 'run', '-o', 'thread backtrace all', '-o', 'quit', '--', executable, 'accessibleRolesAndFlickableScrollingUsePublicQtInterfaces'], {
  env: process.env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
writeFileSync(join(output, 'quick-lldb.txt'), `${result.stdout ?? ''}\n${result.stderr ?? ''}\nDebugger status: ${result.status}; signal: ${result.signal}; error: ${result.error?.code ?? 'none'}\n`);
