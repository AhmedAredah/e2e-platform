/** Installs this verified local kit into the chosen project. External dependencies use npm. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const project = process.argv[2];
if (process.argv.length !== 3 || !project) throw new Error('Usage: node release-packages/install.mjs /absolute/path/to/your-project');
const cwd = resolve(project);
if (!existsSync(join(cwd, 'package.json'))) throw new Error('Create your project package.json first, for example with npm init -y');
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages) || manifest.packages.length !== 9) throw new Error('Invalid install manifest');
const packageNames = new Set(['core', 'process', 'checks', 'protocol', 'native', 'terminal', 'authoring', 'cpp', 'python'].map((name) => `@e2e-platform/${name}`));
const supportNames = new Set(['install.mjs', 'package-manager.mjs']);
if (!Array.isArray(manifest.supportFiles) || manifest.supportFiles.length !== supportNames.size) throw new Error('Invalid installer file manifest');
for (const entry of manifest.supportFiles) {
  if (!supportNames.delete(entry.file)) throw new Error('Invalid installer filename');
  if (createHash('sha256').update(readFileSync(join(directory, entry.file))).digest('hex') !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`);
}
const files = manifest.packages.map((entry) => {
  if (!entry || !packageNames.delete(entry.name)) throw new Error('Unexpected or duplicate package in install manifest');
  if (typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(entry.version)) throw new Error('Invalid package version in install manifest');
  if (typeof entry.file !== 'string' || basename(entry.file) !== entry.file || !entry.file.endsWith('.tgz')) throw new Error('Invalid package filename');
  if (entry.file !== `${entry.name.replace('@', '').replace('/', '-')}-${entry.version}.tgz`) throw new Error('Package filename does not match its declared name and version');
  const file = join(directory, entry.file);
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`);
  return file;
});
const { runPackageManager } = await import('./package-manager.mjs');
const result = runPackageManager('npm', ['install', '--save-dev', ...files], { cwd, stdio: 'inherit' });
if (result.status !== 0) throw new Error('npm install failed');
process.stdout.write('Installed @e2e-platform/core, five application-boundary modules, the shared authoring host and the C++/Python adapters. Install the Python SDK wheel separately with pip. The C++17 SDK and native helpers install separately through CMake or their OS toolchains. For real PTYs, separately install the optional node-pty peer and its native build prerequisites.\n');
