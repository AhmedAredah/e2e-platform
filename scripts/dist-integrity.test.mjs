import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const stamp = fileURLToPath(new URL('./stamp-dist.ts', import.meta.url));
const check = fileURLToPath(new URL('./check-dist.ts', import.meta.url));

/** Exercises the real command-line gates against a package outside the workspace. */
function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'e2e-build-integrity-'));
  const write = (file, text) => writeFileSync(join(cwd, file), text);
  mkdirSync(join(cwd, 'dist')); mkdirSync(join(cwd, 'src'));
  write('package.json', JSON.stringify({ name: 'fixture', version: '0.1.0', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } }, bin: { fixture: './dist/cli.js' } }));
  write('src/index.ts', 'export const value = 1;');
  write('dist/index.js', 'export const value = 1;');
  write('dist/index.d.ts', 'export declare const value = 1;');
  write('dist/cli.js', '#!/usr/bin/env node\n');
  const execute = (script) => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  try { run({ cwd, write, execute }); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('a complete unchanged build passes, but a version-only stamp cannot qualify it', () => fixture(({ write, execute }) => {
  write('dist/.build.json', JSON.stringify({ version: '0.1.0' }));
  assert.equal(execute(check).status, 1);
  assert.equal(execute(stamp).status, 0);
  assert.equal(execute(check).status, 0);
}));

test('absolute public entries cannot be stamped even when their target exists', () => fixture(({ cwd, write, execute }) => {
  write('package.json', JSON.stringify({ name: 'fixture', version: '0.1.0', exports: join(cwd, 'dist/index.js') }));
  assert.equal(execute(stamp).status, 1);
}));

for (const entry of ['index.js', 'index.d.ts', 'cli.js']) {
  test(`missing declared ${entry} prevents both stamping and distribution`, () => fixture(({ cwd, execute }) => {
    assert.equal(execute(stamp).status, 0);
    rmSync(join(cwd, 'dist', entry));
    assert.equal(execute(check).status, 1);
    assert.equal(execute(stamp).status, 1);
  }));
}

for (const [file, text] of [['dist/obsolete.js', 'removed source'], ['dist/index.js', 'altered output'], ['src/index.ts', 'export const value = 2;']]) {
  test(`${file} changing after the build prevents distribution`, () => fixture(({ write, execute }) => {
    assert.equal(execute(stamp).status, 0);
    write(file, text);
    assert.equal(execute(check).status, 1);
  }));
}

for (const sibling of ['process', 'native']) test(`core init cannot ship a stale ${sibling} package version`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-core-build-integrity-'));
  const cwd = join(directory, 'packages/e2e');
  mkdirSync(join(cwd, 'dist'), { recursive: true });
  mkdirSync(join(directory, 'skills/e2e'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: '@e2e-platform/core', version: '0.2.0-rc.1', exports: './dist/index.js' }));
  writeFileSync(join(cwd, 'dist/index.js'), 'export {};');
  for (const name of ['playwright', 'agent-device', 'oauth', 'process', 'native']) {
    mkdirSync(join(directory, 'packages', name));
    writeFileSync(join(directory, 'packages', name, 'package.json'), JSON.stringify({ version: '0.2.0-rc.1' }));
  }
  try {
    assert.equal(spawnSync(process.execPath, [stamp], { cwd }).status, 0);
    assert.equal(spawnSync(process.execPath, [check], { cwd }).status, 0);
    writeFileSync(join(directory, 'packages', sibling, 'package.json'), JSON.stringify({ version: '0.2.0-rc.2' }));
    const result = spawnSync(process.execPath, [check], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /build inventory differs/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the real checks build removes obsolete compiler output before stamping', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'e2e-clean-build-'));
  const cwd = join(temp, 'packages/checks');
  mkdirSync(join(cwd, 'dist'), { recursive: true });
  mkdirSync(join(temp, 'scripts'));
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'src']) cpSync(join(root, 'packages/checks', file), join(cwd, file), { recursive: true });
  for (const file of ['stamp-dist.ts', 'dist-integrity.mjs']) cpSync(join(root, 'scripts', file), join(temp, 'scripts', file));
  cpSync(join(root, 'tsconfig.base.json'), join(temp, 'tsconfig.base.json'));
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'junction');
  writeFileSync(join(cwd, 'dist/removed-old-module.js'), 'obsolete output');
  try {
    const metadata = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const result = spawnSync(metadata.scripts.build, {
      cwd, shell: true, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}` },
    });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(join(cwd, 'dist/removed-old-module.js')), false);
    assert.equal(spawnSync(process.execPath, [check], { cwd }).status, 0);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
