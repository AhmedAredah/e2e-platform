import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Stable byte inventory; symlinks cannot silently add files outside the build tree. */
function inventory(root, paths, excluded = new Set()) {
  const files = {};
  function visit(path) {
    const key = relative(root, path).replaceAll('\\', '/');
    if (excluded.has(key)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Build inventory cannot contain a symlink: ${key}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).toSorted()) visit(join(path, name));
    } else if (stat.isFile()) {
      files[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
    } else throw new Error(`Unsupported build inventory entry: ${key}`);
  }
  for (const path of paths) visit(resolve(root, path));
  return Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b)));
}

/** Every declared entry must exist before a build can be stamped or distributed. */
function validateEntries(root, metadata) {
  function check(value) {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') { for (const entry of Object.values(value)) check(entry); return; }
    if (typeof value !== 'string') throw new Error('Invalid package entry declaration');
    const path = resolve(root, value);
    const local = relative(root, path);
    if (isAbsolute(value) || isAbsolute(local) || local.startsWith('..') || local === '' || value.includes('*')) throw new Error(`Unsupported public entry: ${value}`);
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`Missing public entry: ${value}`);
  }
  for (const field of ['exports', 'bin', 'types', 'main', 'module']) check(metadata[field]);
}

/** Captures source/configuration and every shipped generated file in a completed build. */
export function buildInventory(root = process.cwd()) {
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  validateEntries(root, metadata);
  const outputs = ['dist'];
  if (metadata.files?.includes('skills')) outputs.push('skills');
  const inputs = ['package.json', 'src', 'tsconfig.json', 'tsconfig.build.json', '../../tsconfig.base.json'].filter((path) => existsSync(resolve(root, path)));
  if (metadata.name === '@e2e-platform/core') inputs.push('../../skills/e2e', '../playwright/package.json', '../agent-device/package.json', '../oauth/package.json', '../process/package.json', '../native/package.json');
  return {
    schemaVersion: 1,
    name: metadata.name,
    version: metadata.version,
    inputs: inventory(root, inputs),
    outputs: inventory(root, outputs, new Set(['dist/.build.json'])),
  };
}

/** Rejects a changed source tree, altered output, removed entry, or unexpected output file. */
export function verifyBuild(root = process.cwd()) {
  const actual = buildInventory(root);
  const stamp = JSON.parse(readFileSync(join(root, 'dist/.build.json'), 'utf8'));
  if (JSON.stringify(stamp) !== JSON.stringify(actual)) {
    throw new Error(`${actual.name}@${actual.version}: build inventory differs from source or output; run a clean build before packing`);
  }
}
