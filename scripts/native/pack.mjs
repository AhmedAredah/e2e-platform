/** Packs the built application-boundary modules and their runner for installation without publishing. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPackageManager } from './package-manager.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.argv.length > 3) throw new Error('Usage: node scripts/native/pack.mjs [output-directory]');
const output = process.argv[2] === undefined ? join(root, 'release-packages') : resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
const packages = [];
for (const directory of ['e2e', 'process', 'checks', 'protocol', 'native', 'terminal']) {
  const cwd = join(root, 'packages', directory);
  const metadata = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  const check = spawnSync(process.execPath, [join(root, 'scripts/check-dist.ts')], { cwd, stdio: 'inherit' });
  if (check.status !== 0) throw new Error(`Build ${metadata.name} before packing`);
  const result = runPackageManager('pnpm', ['pack', '--pack-destination', output], { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Packing ${metadata.name} failed`);
  const file = `${metadata.name.replace('@', '').replace('/', '-')}-${metadata.version}.tgz`;
  const sha256 = createHash('sha256').update(readFileSync(join(output, file))).digest('hex');
  packages.push({ name: metadata.name, version: metadata.version, file, sha256 });
}
const expected = new Set(packages.map((entry) => entry.file));
const stale = readdirSync(output).filter((file) => file.endsWith('.tgz') && !expected.has(file));
if (stale.length) throw new Error(`Remove stale tarballs before distributing: ${stale.join(', ')}`);
copyFileSync(join(root, 'scripts/native/install-packed.mjs'), join(output, 'install.mjs'));
copyFileSync(join(root, 'scripts/native/package-manager.mjs'), join(output, 'package-manager.mjs'));
const supportFiles = ['install.mjs', 'package-manager.mjs'].map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(join(output, file))).digest('hex') }));
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, packages, supportFiles }, null, 2)}\n`);
process.stdout.write(`Install kit written to ${output}\n`);
