import { createProcessTest } from '@e2e-platform/process/test';
import { LocalProcessRunner } from '@e2e-platform/process';
import { AuthoredTestHost, type AuthoredTestOptions } from './host.ts';
import { MAX_LINE_BYTES, invalid, record, string, timeout } from './protocol.ts';
import { decodeJson } from './json.ts';

export { AuthoredTestHost } from './host.ts';
export type { AuthoredTestOptions } from './host.ts';

/** Discovers foreign-language tests and registers each with the shared runner. Await at module scope. */
export async function registerAuthoredTests(options: AuthoredTestOptions): Promise<void> {
  string(options.executable);
  if (options.language !== undefined && options.language !== 'C++' && options.language !== 'Python') invalid();
  const deadline = timeout(options.timeoutMs, 30_000);
  const runner = options.runner ?? new LocalProcessRunner();
  const result = await runner.run({
    executable: options.executable, args: [...options.args ?? [], '--e2e-list'],
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    timeoutMs: timeout(options.discoveryTimeoutMs, 5000), maxOutputBytes: MAX_LINE_BYTES,
  });
  if (result.stdout.truncated || result.stderr.truncated) invalid();
  const raw = decodeJson(result.stdout.bytes);
  const manifest = record(raw, ['protocol', 'tests']);
  if (manifest.protocol !== 2 || !Array.isArray(manifest.tests) || manifest.tests.length === 0 || manifest.tests.length > 10_000) invalid();
  const names = manifest.tests.map(value => string(value, 1024));
  if (names.some(name => name.trim() !== name || name.length === 0 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) || new Set(names).size !== names.length) invalid();
  const test = createProcessTest({ runner }).extend<{ authored: AuthoredTestHost }>({
    authored: async (fixtures, use, context) => { await use(new AuthoredTestHost(fixtures, context, options.language)); },
  });
  for (const name of names) test(name, { timeout: deadline }, async ({ authored }) => { if (await authored.run(options, name) === 'skipped') test.skip('Python case skipped'); });
}
