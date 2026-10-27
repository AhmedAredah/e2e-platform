import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNativeReport } from './verification-report.mjs';
import { readBuildQualification } from './build-qualification.mjs';

/** Produces a real report-shaped intended assertion failure with complete cleanup. */
function negativeReport() {
  return { schemaVersion: 'report-1', run: { status: 'failed', errors: [], results: [{
    kind: 'test', status: 'failed', titlePath: ['rejects a planted error'],
    attempts: [{ cleanup: 'complete', error: { code: 'ASSERTION_FAILED', category: 'test' } }],
  }] } };
}
const failure = { expected: 'failed', failureTitle: 'rejects a planted error' };

test('qualification requires the intended assertion and complete owned-process cleanup', () => {
  assert.equal(validateNativeReport(negativeReport(), failure).status, 'failed');
  for (const mutate of [
    (report) => { report.run.results[0].attempts[0].error.code = 'DEPENDENCY_MISSING'; },
    (report) => { report.run.results[0].attempts[0].cleanup = 'incomplete'; },
    (report) => { report.run.results[0].attempts = []; },
    (report) => { report.run.results[0].attempts.push(report.run.results[0].attempts[0]); },
    (report) => { report.run.errors = [{ code: 'DRIVER_CRASHED' }]; },
    (report) => { report.run.results[0].titlePath = ['unexpected failure']; },
  ]) {
    const report = negativeReport(); mutate(report);
    assert.throws(() => validateNativeReport(report, failure));
  }
});

test('qualification identifies the active CMake compiler even with stale metadata directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-toolchain-evidence-'));
  try {
    const qt = join(directory, 'qt');
    await mkdir(qt);
    await mkdir(join(directory, 'CMakeFiles', '3.28.3'), { recursive: true });
    await mkdir(join(directory, 'CMakeFiles', '3.24.0'), { recursive: true });
    await writeFile(join(directory, 'CMakeCache.txt'), `CMAKE_CACHE_MAJOR_VERSION:INTERNAL=3\nCMAKE_CACHE_MINOR_VERSION:INTERNAL=28\nCMAKE_CACHE_PATCH_VERSION:INTERNAL=3\nCMAKE_GENERATOR:INTERNAL=Ninja\n// Build type can have comments and empty lines.\n\nCMAKE_BUILD_TYPE:STRING=Release\nQt6Core_DIR:PATH=${qt}\n`);
    await writeFile(join(directory, 'CMakeFiles', '3.28.3', 'CMakeCXXCompiler.cmake'), 'set(CMAKE_CXX_COMPILER_ID "GNU")\nset(CMAKE_CXX_COMPILER_VERSION "12.2.0")\nset(CMAKE_CXX_COMPILER "/usr/bin/c++")\n');
    await writeFile(join(qt, 'Qt6CoreConfigVersionImpl.cmake'), 'set(PACKAGE_VERSION "6.4.2")\n');
    const result = readBuildQualification(directory);
    assert.deepEqual(result.compiler, { id: 'GNU', version: '12.2.0', path: '/usr/bin/c++' });
    assert.equal(result.qt, '6.4.2');
    assert.equal(result.cmake, '3.28.3');
    assert.equal(result.buildType, 'Release');
    await rm(join(qt, 'Qt6CoreConfigVersionImpl.cmake'));
    assert.throws(() => readBuildQualification(directory), /version cannot be recorded/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
