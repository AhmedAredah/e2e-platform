import { join } from 'node:path';
import { expect, test } from '@e2e-platform/process/test';
import { compareJson } from '@e2e-platform/checks';
import { evidence, executable, exportedResult } from '../test-support.ts';

test('rejects the planted wrong result even though the program exits successfully', async ({ processes }) => {
  const directory = await evidence('planted-wrong-output');
  const result = await processes.run({
    executable,
    args: ['sum', '--a', '1.5', '--b', '2.5', '--wrong-output', '--output', join(directory, 'result.json')],
    timeoutMs: 5_000,
    stdoutPath: join(directory, 'stdout.log'),
    stderrPath: join(directory, 'stderr.log'),
  });

  expect(result.exitCode).toBe(0);
  const comparison = compareJson(await exportedResult(directory), {
    schemaVersion: 1, operation: 'sum', operands: [1.5, 2.5], sum: 4,
  });
  expect(comparison.differences).toEqual([]);
  expect(comparison.matches).toBe(true);
});
