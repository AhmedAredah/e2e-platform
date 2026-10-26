import { readJsonFile } from '@e2e-cpp/checks';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const executable = process.env['E2E_CPP_BINARY'] ?? resolve('build', 'bin', process.platform === 'win32' ? 'e2e_cpp_calculator.exe' : 'e2e_cpp_calculator');

/** Creates a retained, test-specific destination for the real program's output. */
export async function evidence(name: string): Promise<string> {
  const root = process.env['E2E_CPP_EVIDENCE'] ?? resolve('.e2e', 'cpp-evidence');
  await mkdir(root, { recursive: true });
  const directory = join(await mkdtemp(join(root, `${name}-`)), 'project café مشروع');
  await mkdir(directory);
  return directory;
}

/** Reads a deliberately small JSON result; schema/value validation belongs to the test oracle. */
export async function exportedResult(directory: string): Promise<unknown> {
  return readJsonFile(join(directory, 'result.json'), 1024 * 1024, { decimalPrecision: 'binary64' });
}
