import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { configuredExecutables, primaryExecutableArtifact, requireExecutableTarget } from './cmake-targets.mjs';

test('selects Windows executable when CMake also reports PDB and import-library artifacts', () => {
  assert.equal(primaryExecutableArtifact({ name: 'demo', type: 'EXECUTABLE', nameOnDisk: 'demo.exe', artifacts: [
    { path: 'Release/demo.pdb' }, { path: 'Release/demo.lib' }, { path: 'Release/demo.exe' },
  ] }), 'Release/demo.exe');
});

test('uses the current named artifact rather than another configuration or filename', () => {
  assert.equal(primaryExecutableArtifact({ name: 'demo', type: 'EXECUTABLE', nameOnDisk: 'demo-renamed', artifacts: [
    { path: '/build/Release/demo-renamed' }, { path: '/build/demo-old' },
  ] }), '/build/Release/demo-renamed');
});

test('does not guess an executable from an unmatched or ambiguous artifact set', () => {
  assert.throws(() => primaryExecutableArtifact({ name: 'demo', type: 'EXECUTABLE', nameOnDisk: 'demo.exe', artifacts: [
    { path: 'old.exe' },
  ] }), /unambiguous/);
  assert.throws(() => primaryExecutableArtifact({ name: 'demo', type: 'EXECUTABLE', nameOnDisk: 'demo.exe', artifacts: [
    { path: 'Debug/demo.exe' }, { path: 'Release/demo.exe' },
  ] }), /unambiguous/);
});

test('permits one legacy primary artifact and leaves library targets out', () => {
  assert.equal(primaryExecutableArtifact({ name: 'demo', type: 'EXECUTABLE', artifacts: [{ path: 'demo' }] }), 'demo');
  assert.equal(primaryExecutableArtifact({ name: 'helper', type: 'STATIC_LIBRARY', nameOnDisk: 'helper.a', artifacts: [{ path: 'helper.a' }] }), undefined);
});

/** Creates a minimal CMake File API reply with one built artifact. */
function withCodemodel(artifact, run) {
  const build = mkdtempSync(join(tmpdir(), 'e2e CMake & targets '));
  const reply = join(build, '.cmake/api/v1/reply'); mkdirSync(reply, { recursive: true });
  writeFileSync(join(reply, 'index-current.json'), JSON.stringify({ reply: { 'codemodel-v2': { jsonFile: 'model.json' } } }));
  writeFileSync(join(reply, 'model.json'), JSON.stringify({ paths: { build }, configurations: [
    { name: 'Debug', targets: [] }, { name: 'Release', targets: [{ jsonFile: 'target.json' }] },
  ] }));
  writeFileSync(join(reply, 'target.json'), JSON.stringify({ name: 'demo', type: 'EXECUTABLE', nameOnDisk: artifact.split('/').at(-1), artifacts: [{ path: artifact }, { path: 'Release/demo.pdb' }] }));
  const executable = join(build, artifact); mkdirSync(dirname(executable), { recursive: true }); writeFileSync(executable, 'fixture executable');
  try { run(build, executable); } finally { rmSync(build, { recursive: true, force: true }); }
}

for (const artifact of ['Release/demo.exe', 'Release/demo', 'bin/demo']) {
  test(`shared CMake discovery resolves ${artifact} instead of guessing the executable path`, () => {
    withCodemodel(artifact, (build, executable) => {
      assert.equal(requireExecutableTarget(configuredExecutables(build), 'demo'), executable);
      assert.throws(() => configuredExecutables(build, 'Missing'), /no Missing configuration/);
      assert.throws(() => requireExecutableTarget(configuredExecutables(build, 'Debug'), 'demo'), /did not build demo/);
      rmSync(executable);
      assert.throws(() => requireExecutableTarget(configuredExecutables(build), 'demo'), /did not build demo/);
    });
  });
}
