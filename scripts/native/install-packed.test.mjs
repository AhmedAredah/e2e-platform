import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** Exercises the shipped installer without invoking npm or accessing the network. */
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'platform install kit & '));
  const project = join(directory, 'consumer project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), '{"private":true}');
  copyFileSync(new URL('./install-packed.mjs', import.meta.url), join(directory, 'install.mjs'));
  writeFileSync(join(directory, 'package-manager.mjs'), `import { writeFileSync } from 'node:fs';
export function runPackageManager(name, args, options) {
  writeFileSync(${JSON.stringify(join(directory, 'invoked.json'))}, JSON.stringify({ name, args, cwd: options.cwd }));
  return { status: 0 };
}`);
  const hash = (file) => createHash('sha256').update(readFileSync(join(directory, file))).digest('hex');
  const packages = ['core', 'process', 'checks', 'protocol', 'native', 'terminal', 'authoring', 'cpp', 'python'].map((suffix) => {
    const name = `@e2e-platform/${suffix}`;
    const version = '0.2.0-rc.1';
    const file = `e2e-platform-${suffix}-${version}.tgz`;
    writeFileSync(join(directory, file), `fixture ${name}`);
    return { name, version, file, sha256: hash(file) };
  });
  const manifest = { schemaVersion: 1, packages, supportFiles: ['install.mjs', 'package-manager.mjs'].map((file) => ({ file, sha256: hash(file) })) };
  const execute = () => {
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
    return spawnSync(process.execPath, [join(directory, 'install.mjs'), project], { encoding: 'utf8', timeout: 5000 });
  };
  try { run({ directory, project, manifest, execute }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('installer passes the nine checked local package paths to npm without a shell', () => fixture(({ directory, project, manifest, execute }) => {
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  // Node resolves the installer module through filesystem aliases (macOS
  // /var -> /private/var); the explicitly supplied project cwd stays literal.
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'invoked.json'), 'utf8')), {
    name: 'npm', args: ['install', '--save-dev', ...manifest.packages.map(({ file }) => join(realpathSync(directory), file))], cwd: project,
  });
}));

for (const [name, alter, message] of [
  ['duplicate package', ({ manifest }) => { manifest.packages[1] = manifest.packages[0]; }, /Unexpected or duplicate package/],
  ['unexpected package', ({ manifest }) => { manifest.packages[0].name = '@other/core'; }, /Unexpected or duplicate package/],
  ['invalid version', ({ manifest }) => { manifest.packages[0].version = '../other'; }, /Invalid package version/],
  ['wrong filename', ({ manifest }) => { manifest.packages[0].version = '0.9.0'; }, /filename does not match/],
  ['damaged tarball', ({ directory, manifest }) => { writeFileSync(join(directory, manifest.packages[0].file), 'modified'); }, /Checksum mismatch/],
  ['damaged support script', ({ directory }) => { writeFileSync(join(directory, 'package-manager.mjs'), 'throw new Error("should never execute");'); }, /Checksum mismatch/],
]) test(`installer rejects a ${name} before invoking npm`, () => fixture((context) => {
  alter(context);
  const result = context.execute();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
  assert.equal(existsSync(join(context.directory, 'invoked.json')), false);
}));
