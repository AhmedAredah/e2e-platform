/** Builds Python source/wheel distributions with a checksummed completion manifest. */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { python: { type: 'string' }, out: { type: 'string' }, 'sync-version': { type: 'boolean' }, 'check-version': { type: 'boolean' } } });
const npm = JSON.parse(await readFile(join(root, 'packages/python/package.json'), 'utf8'));
const version = npm.version.replace(/-rc\.(\d+)$/, 'rc$1').replace(/-canary-(\d+)$/, '.dev$1');
if (!/^\d+\.\d+\.\d+(?:rc\d+|\.dev\d+)?$/.test(version)) throw new Error('Python packaging requires a stable, rc or dated canary version');
const metadata = join(root, 'sdks/python/pyproject.toml');
const source = await readFile(metadata, 'utf8');
if (values['sync-version']) await writeFile(metadata, source.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
else if (!source.includes(`\nversion = "${version}"\n`)) throw new Error('Python SDK version differs from its runner adapter; run node scripts/python/package.mjs --sync-version');
if (!values['check-version'] && !values['sync-version']) {
  const output = resolve(values.out ?? join(root, 'release-packages/python'));
  await mkdir(output, { recursive: true });
  await rm(join(output, 'manifest.json'), { force: true });
  const temporary = await mkdtemp(join(tmpdir(), 'e2e-python-distributions-'));
  try {
    const sdk = join(temporary, 'source');
    await cp(join(root, 'sdks/python'), sdk, { recursive: true, filter: path => !/(?:^|[/\\])(?:build|dist|__pycache__|\.pytest_cache)(?:[/\\]|$)|\.egg-info/.test(path) });
    const dist = join(temporary, 'dist');
    const result = spawnSync(values.python ?? process.env.E2E_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-m', 'build', sdk, '--outdir', dist], { stdio: 'inherit', timeout: 240000 });
    if (result.status !== 0 || result.error) throw new Error('Python distribution build failed', { cause: result.error });
    const names = await readdir(dist);
    if (names.length !== 2 || !names.includes(`e2e_platform-${version}-py3-none-any.whl`) || !names.includes(`e2e_platform-${version}.tar.gz`)) throw new Error('Unexpected Python distribution files');
    const files = [];
    for (const name of names.toSorted()) {
      const content = await readFile(join(dist, name));
      await writeFile(join(output, name), content);
      files.push({ file: name, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length });
    }
    await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, name: 'e2e-platform', version, runnerVersion: npm.version, files }, null, 2) + '\n');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
