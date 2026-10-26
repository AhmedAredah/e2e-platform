/** Builds and consumes both installed Qt library variants, including hidden shared symbols. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../packages/process/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'e2e-qt-install-'));
/** Runs CMake/CTest using the same bounded supervisor as a consumer. */
async function run(executable, args, env = process.env) {
  const result = await runProcess({ executable, args, env, cwd: root, timeoutMs: 180_000, maxOutputBytes: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout.bytes);
  process.stderr.write(result.stderr.bytes);
}
try {
  for (const shared of ['OFF', 'ON']) {
    const build = join(directory, `build-${shared}`);
    const prefix = join(directory, `install-${shared}`);
    const consumer = join(directory, `consumer-${shared}`);
    await run('cmake', ['-S', join(root, 'native/qt'), '-B', build, '-DBUILD_TESTING=OFF', `-DBUILD_SHARED_LIBS=${shared}`, '-DCMAKE_CXX_VISIBILITY_PRESET=hidden', '-DCMAKE_VISIBILITY_INLINES_HIDDEN=ON', '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_INSTALL_PREFIX=${prefix}`]);
    await run('cmake', ['--build', build, '--config', 'Release', '--parallel', '2']);
    await run('cmake', ['--install', build, '--config', 'Release']);
    for (const name of ['LICENSE', 'THIRD_PARTY.md']) {
      const expected = await readFile(join(root, 'native/qt', name));
      const installed = await readFile(join(prefix, 'share/licenses/e2eQtBridge', name));
      if (!expected.equals(installed)) throw new Error(`Installed Qt ${name} differs from its source`);
    }
    const env = { ...process.env, CMAKE_PREFIX_PATH: [prefix, process.env.CMAKE_PREFIX_PATH].filter(Boolean).join(delimiter), PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH ?? ''}` };
    await run('cmake', ['-S', join(root, 'native/qt/tests/consumer'), '-B', consumer, '-DCMAKE_BUILD_TYPE=Release'], env);
    await run('cmake', ['--build', consumer, '--config', 'Release'], env);
    await run('ctest', ['--test-dir', consumer, '-C', 'Release', '--output-on-failure'], env);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
process.stdout.write('Installed static and shared Qt consumer builds and runs passed.\n');
