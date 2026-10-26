import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execute = promisify(execFile);

test('malformed response diagnostics omit body contents from CLI output and artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-http-diagnostics-'));
  const marker = 'TOPSECRET';
  try {
    const core = new URL('../../e2e/dist/index.js', import.meta.url).href;
    const protocol = new URL('../dist/index.js', import.meta.url).href;
    await writeFile(join(directory, 'e2e.config.ts'), `export default { modelPolicy: 'forbid', tests: ['*.e2e.ts'], targets: [{ name: 'http', platform: 'test' }], retries: 0 };\n`);
    await writeFile(join(directory, 'response.e2e.ts'), `import { test } from ${JSON.stringify(core)};
import { HttpResponse } from ${JSON.stringify(protocol)};
test('malformed response', async () => {
  new HttpResponse(new Response(), new TextEncoder().encode(process.env.PROTOCOL_TEST_BODY)).json();
});\n`);
    const result = await execute(process.execPath, [fileURLToPath(new URL('../../e2e/dist/cli/bin.js', import.meta.url)), 'run', '--no-model'], {
      cwd: directory, timeout: 10_000, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', PROTOCOL_TEST_BODY: marker },
    }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }), (cause: unknown) => {
      const error = cause as Error & { code: number; stdout: string; stderr: string };
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    });
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toContain('HTTP response is not valid JSON');
    expect(result.stdout + result.stderr).not.toContain(marker);
    const output = join(directory, '.e2e');
    const report = await readFile(join(output, 'report.json'), 'utf8');
    expect(report).toContain('HTTP response is not valid JSON');
    for (const relative of await readdir(output, { recursive: true })) {
      const file = join(output, relative);
      if ((await stat(file)).isFile()) expect(await readFile(file, 'utf8'), relative).not.toContain(marker);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);
