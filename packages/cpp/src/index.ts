import { createProcessTest } from '@e2e-platform/process/test';
import { LocalProcessRunner } from '@e2e-platform/process';
import { CppTestHost, type CppTestOptions } from './host.ts';
import { MAX_LINE_BYTES, invalid, record, string, timeout } from './protocol.ts';

export type { CppTestOptions } from './host.ts';

/** Discovers compiled C++ tests and registers each with the shared runner. Await at module scope. */
export async function registerCppTests(options: CppTestOptions): Promise<void> {
  string(options.executable);
  const deadline = timeout(options.timeoutMs, 30_000);
  const runner = options.runner ?? new LocalProcessRunner();
  const result = await runner.run({
    executable: options.executable, args: [...options.args ?? [], '--e2e-list'],
    ...(options.env === undefined ? {} : { env: options.env }),
    timeoutMs: timeout(options.discoveryTimeoutMs, 5000), maxOutputBytes: MAX_LINE_BYTES,
  });
  if (result.stdout.truncated || result.stderr.truncated) invalid();
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout.bytes)); } catch { invalid(); }
  const manifest = record(raw, ['protocol', 'tests']);
  if (manifest.protocol !== 2 || !Array.isArray(manifest.tests) || manifest.tests.length === 0 || manifest.tests.length > 10_000) invalid();
  const names = manifest.tests.map(value => string(value, 1024));
  if (names.some(name => name.trim() !== name || name.length === 0 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) || new Set(names).size !== names.length) invalid();
  const test = createProcessTest({ runner }).extend<{ cpp: CppTestHost }>({
    cpp: async (fixtures, use, context) => { await use(new CppTestHost(fixtures, context)); },
  });
  for (const name of names) test(name, { timeout: deadline }, async ({ cpp }) => { await cpp.run(options, name); });
}
