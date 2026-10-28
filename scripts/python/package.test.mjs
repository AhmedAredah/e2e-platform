import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const mismatch of [false, true]) test(`Python packaging handles CRLF and revokes an earlier manifest after ${mismatch ? 'version mismatch' : 'build startup failure'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'python-package-failure-'));
  try {
    for (const directory of ['scripts/python', 'packages/python', 'sdks/python', 'output']) await mkdir(join(root, directory), { recursive: true });
    await cp(new URL('./package.mjs', import.meta.url), join(root, 'scripts/python/package.mjs'));
    await writeFile(join(root, 'packages/python/package.json'), JSON.stringify({ version: '0.2.0-rc.8' }));
    await writeFile(join(root, 'sdks/python/pyproject.toml'), `\r\nversion = "${mismatch ? '0.2.0rc7' : '0.2.0rc8'}"\r\n`);
    await writeFile(join(root, 'output/manifest.json'), '{"previous":"success"}');
    const result = spawnSync(process.execPath, [join(root, 'scripts/python/package.mjs'), '--out', join(root, 'output'), '--python', join(root, 'missing-python')], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, mismatch ? /version differs/ : /build failed/);
    await assert.rejects(readFile(join(root, 'output/manifest.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
