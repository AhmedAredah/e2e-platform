import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runPackageManager } from './package-manager.mjs';

/** Writes a harmless manager entry that echoes the arguments it actually received. */
function entry(path, marker) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `process.stdout.write(JSON.stringify({ marker: ${JSON.stringify(marker)}, args: process.argv.slice(2) }));`);
}

/** Runs one isolated Windows resolver fixture using the real host Node executable. */
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'e2e managers with spaces & '));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

const argumentsWithSyntax = ['install', '--save-dev', 'C:\\Users\\Jane Doe\\kit & name\\package.tgz', 'percent%value', 'caret^value', 'quote"value', '$(not-a-command)', ''];

test('Windows npm shim preserves every argument without shell interpolation', () => fixture((directory) => {
  writeFileSync(join(directory, 'npm.cmd'), '@"%~dp0\\node_modules\\npm\\bin\\npm-cli.js" %*');
  entry(join(directory, 'node_modules/npm/bin/npm-cli.js'), 'npm');
  const result = runPackageManager('npm', argumentsWithSyntax, {
    encoding: 'utf8', env: { Path: `"${directory}"` }, shell: true,
  }, { platform: 'win32' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: 'npm', args: argumentsWithSyntax });
}));

for (const extension of ['cjs', 'mjs']) test(`Windows pnpm .bin shim resolves its ${extension} entry with path characters intact`, () => fixture((directory) => {
  const bin = join(directory, 'node_modules/.bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'pnpm.cmd'), `@"%~dp0\\..\\pnpm\\bin\\pnpm.${extension}" %*`);
  entry(join(directory, `node_modules/pnpm/bin/pnpm.${extension}`), 'pnpm');
  const result = runPackageManager('pnpm', argumentsWithSyntax, { encoding: 'utf8', env: { PATH: bin } }, { platform: 'win32' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: 'pnpm', args: argumentsWithSyntax });
}));

/** Models pnpm 12's native bin and its supported JavaScript compatibility entry. */
function nativePnpm(directory) {
  entry(join(directory, 'bin/pnpm.mjs'), 'pnpm-native-wrapper');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'pnpm', bin: { pnpm: 'pnpm.exe' } }));
  // These must never be passed to Node or interpreted as shell scripts.
  writeFileSync(join(directory, 'pnpm'), 'not JavaScript or a shell command');
  writeFileSync(join(directory, 'pnpm.exe'), 'not JavaScript or an executable');
}

for (const layout of ['local', 'global']) for (const target of ['pnpm', 'pnpm.exe']) {
  test(`Windows pnpm 12 ${layout} shim targeting ${target} preserves argument boundaries`, () => fixture((directory) => {
    const bin = layout === 'local' ? join(directory, 'node_modules/.bin') : directory;
    const relativePackage = layout === 'local' ? '..\\pnpm' : 'node_modules\\pnpm';
    const prefix = layout === 'local' ? '%~dp0' : '%dp0%';
    mkdirSync(bin, { recursive: true });
    nativePnpm(join(directory, 'node_modules/pnpm'));
    entry(join(directory, 'node_modules/corepack/dist/pnpm.js'), 'wrong-corepack');
    writeFileSync(join(bin, 'pnpm.cmd'), `@"${prefix}\\${relativePackage}\\${target}" %*`);
    const result = runPackageManager('pnpm', argumentsWithSyntax, {
      encoding: 'utf8', env: { Path: `"${bin}"` }, shell: true,
    }, { platform: 'win32' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { marker: 'pnpm-native-wrapper', args: argumentsWithSyntax });
  }));
}

test('Windows pnpm native shim refuses unrelated targets and invalid package metadata', () => fixture((directory) => {
  const bin = join(directory, 'node_modules/.bin'); mkdirSync(bin, { recursive: true });
  const packageDirectory = join(directory, 'node_modules/pnpm');
  nativePnpm(packageDirectory);
  const shim = join(bin, 'pnpm.cmd');
  const invoke = () => runPackageManager('pnpm', [], { env: { PATH: bin } }, { platform: 'win32' });
  for (const wrapper of [
    '@echo unknown-wrapper',
    '@"%~dp0\\..\\other\\pnpm.exe" %*',
    '@"%~dp0\\..\\pnpm\\pnpm.exe.untrusted" %*',
    '@"%~dp0\\..\\pnpm\\..\\other\\pnpm.exe" %*',
  ]) {
    writeFileSync(shim, wrapper);
    assert.throws(invoke, /Cannot safely resolve/, wrapper);
  }
  writeFileSync(shim, '@"%~dp0\\..\\pnpm\\pnpm" %*');
  for (const manifest of [
    '{not json}',
    'null',
    JSON.stringify({ name: 'another-package', bin: { pnpm: 'pnpm' } }),
    JSON.stringify({ name: 'pnpm', bin: { pnpm: '../../untrusted.exe' } }),
  ]) {
    writeFileSync(join(packageDirectory, 'package.json'), manifest);
    assert.throws(invoke, /Cannot safely resolve/, manifest);
  }
  nativePnpm(packageDirectory);
  rmSync(join(packageDirectory, 'pnpm'));
  assert.throws(invoke, /Cannot safely resolve/, 'missing native target');
  nativePnpm(packageDirectory);
  rmSync(join(packageDirectory, 'bin/pnpm.mjs'));
  assert.throws(invoke, /Cannot safely resolve/, 'missing compatibility entry');
}));

test('Windows Corepack shim does not accidentally select another pnpm installation', () => fixture((directory) => {
  writeFileSync(join(directory, 'pnpm.cmd'), '@"%~dp0\\node_modules\\corepack\\dist\\pnpm.js" %*');
  entry(join(directory, 'node_modules/pnpm/bin/pnpm.js'), 'wrong-manager');
  entry(join(directory, 'node_modules/corepack/dist/pnpm.js'), 'corepack');
  const result = runPackageManager('pnpm', argumentsWithSyntax, { encoding: 'utf8', env: { PATH: directory } }, { platform: 'win32' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: 'corepack', args: argumentsWithSyntax });
}));

test('Windows uses its inherited matching npm CLI and refuses unknown batch wrappers', () => fixture((directory) => {
  const cli = join(directory, 'npm-cli.js'); entry(cli, 'inherited');
  const result = runPackageManager('npm', argumentsWithSyntax, { encoding: 'utf8', env: { npm_execpath: cli, PATH: directory } }, { platform: 'win32' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: 'inherited', args: argumentsWithSyntax });
  writeFileSync(join(directory, 'pnpm.cmd'), '@echo unknown-wrapper');
  assert.throws(() => runPackageManager('pnpm', [], { env: { npm_execpath: cli, PATH: directory } }, { platform: 'win32' }), /Cannot safely resolve/);
}));
