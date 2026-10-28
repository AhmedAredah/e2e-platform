import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);

for (const { customOutput, build } of [
  { customOutput: false, build: false },
  { customOutput: true, build: false },
  { customOutput: false, build: true },
  { customOutput: true, build: true },
]) {
  test(`failed ${build ? 'build' : 'packing'} invalidates the previous ${customOutput ? 'custom' : 'default'} kit`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'e2e-pack-failure-'));
    try {
      const scripts = join(root, 'scripts/native');
      const output = join(root, customOutput ? 'custom kit & files' : 'release-packages');
      const core = join(root, 'packages/e2e');
      await mkdir(scripts, { recursive: true });
      await mkdir(output, { recursive: true });
      await mkdir(core, { recursive: true });
      for (const file of ['pack.mjs', 'package-manager.mjs']) {
        await copyFile(new URL(file, import.meta.url), join(scripts, file));
      }
      if (build) await writeFile(join(scripts, 'package-manager.mjs'), 'export function runPackageManager() { return { status: 1 }; }\n');
      await writeFile(join(core, 'package.json'), JSON.stringify({ name: '@e2e-platform/core', version: '0.1.0' }));
      await writeFile(join(root, 'scripts/check-dist.ts'), 'process.exitCode = 1;\n');
      for (const file of ['manifest.json', 'manifest.json.tmp', 'source-revision.txt']) {
        await writeFile(join(output, file), 'previous successful build');
      }
      await writeFile(join(output, 'unrelated.txt'), 'keep');
      await assert.rejects(execute(process.execPath, [join(scripts, 'pack.mjs'), ...(build ? ['--build'] : []), ...(customOutput ? [output] : [])], { timeout: 10_000 }), build ? /Native package build failed/ : /Build @e2e-platform\/core before packing/);
      for (const file of ['manifest.json', 'manifest.json.tmp', 'source-revision.txt']) {
        await assert.rejects(readFile(join(output, file)), { code: 'ENOENT' });
      }
      assert.equal(await readFile(join(output, 'unrelated.txt'), 'utf8'), 'keep');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
