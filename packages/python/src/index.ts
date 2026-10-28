import path from 'node:path';
import { registerAuthoredTests, type AuthoredTestOptions } from '@e2e-platform/authoring';

export interface PythonTestOptions extends Omit<AuthoredTestOptions, 'executable' | 'args' | 'language'> {
  /** Explicit interpreter with the e2e-platform Python SDK installed. */
  readonly interpreter: string;
  /** Pytest paths relative to cwd; collection imports trusted application code. */
  readonly tests: readonly string[];
  /** Explicit pytest plugins, for example pytest_asyncio.plugin. Autoload is disabled. */
  readonly plugins?: readonly string[];
}

/** Collects pytest node IDs and executes each in a fresh runner-owned Python process. */
export async function registerPythonTests(options: PythonTestOptions): Promise<void> {
  if (!Array.isArray(options.tests) || options.tests.length === 0 || options.tests.some(value => typeof value !== 'string' || !value || value.startsWith('-') || value.includes('\0'))) throw new TypeError('tests must name nonempty pytest paths');
  if (options.plugins !== undefined && (!Array.isArray(options.plugins) || options.plugins.some(value => !/^[a-zA-Z_][a-zA-Z_0-9.]*$/.test(value)))) throw new TypeError('plugins must name importable Python modules');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await registerAuthoredTests({
    executable: options.interpreter, language: 'Python', cwd,
    args: ['-u', '-m', 'e2e_platform', '--root', cwd, ...options.tests.map(value => `--test=${value}`), ...(options.plugins ?? []).map(value => `--plugin=${value}`)],
    env: { ...options.env, PYTHONUTF8: '1', PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTEST_ADDOPTS: '' },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.discoveryTimeoutMs === undefined ? {} : { discoveryTimeoutMs: options.discoveryTimeoutMs }),
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
}
