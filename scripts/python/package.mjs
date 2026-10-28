/** Builds Python source/wheel distributions with a checksummed completion manifest. */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { python: { type: 'string' }, out: { type: 'string' }, 'sync-version': { type: 'boolean' }, 'check-version': { type: 'boolean' } } });
const packing = !values['check-version'] && !values['sync-version'];
const output = resolve(values.out ?? join(root, 'release-packages/python'));
if (packing) {
  await mkdir(output, { recursive: true });
  for (const name of ['manifest.json', 'manifest.json.tmp']) await rm(join(output, name), { force: true });
}
const npm = JSON.parse(await readFile(join(root, 'packages/python/package.json'), 'utf8'));
const version = npm.version.replace(/-rc\.(\d+)$/, 'rc$1').replace(/-canary-(\d+)$/, '.dev$1');
if (!/^\d+\.\d+\.\d+(?:rc\d+|\.dev\d+)?$/.test(version)) throw new Error('Python packaging requires a stable, rc or dated canary version');
const metadata = join(root, 'sdks/python/pyproject.toml');
const source = await readFile(metadata, 'utf8');
if (values['sync-version']) await writeFile(metadata, source.replace(/^version = "[^"]+"(\r?)$/m, `version = "${version}"$1`));
else if (source.match(/^version = "([^"]+)"\r?$/m)?.[1] !== version) throw new Error('Python SDK version differs from its runner adapter; run node scripts/python/package.mjs --sync-version');
if (packing) {
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
    const stale = (await readdir(output)).filter(name => (name.endsWith('.whl') || name.endsWith('.tar.gz')) && !names.includes(name));
    if (stale.length) throw new Error(`Remove stale Python distributions before packaging: ${stale.join(', ')}`);
    await writeFile(join(output, 'manifest.json.tmp'), JSON.stringify({ schemaVersion: 1, name: 'e2e-platform', version, runnerVersion: npm.version, files }, null, 2) + '\n');
    await rename(join(output, 'manifest.json.tmp'), join(output, 'manifest.json'));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
