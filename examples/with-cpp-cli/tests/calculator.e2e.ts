import { join } from 'node:path';
import { expect, test } from '@e2e-platform/process/test';
import { assertComparison, compareJson } from '@e2e-platform/checks';
import { evidence, executable, exportedResult } from '../test-support.ts';

test('exports independently checked numbers from a real C++ executable', async ({ processes }) => {
  const directory = await evidence('sum');
  const result = await processes.run({
    executable,
    args: ['sum', '--a', '0.1', '--b', '0.2', '--output', join(directory, 'result.json')],
    timeoutMs: 5_000,
    stdoutPath: join(directory, 'stdout.log'),
    stderrPath: join(directory, 'stderr.log'),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr.bytes.byteLength).toBe(0);
  const expected = { schemaVersion: 1, operation: 'sum', operands: [0.1, 0.2], sum: 0.3 };
  assertComparison(compareJson(await exportedResult(directory), expected, { numbers: { absolute: 1e-12 } }));
  assertComparison(compareJson(JSON.parse(result.stdout.bytes.toString('utf8')), expected, { numbers: { absolute: 1e-12 } }));
});

test('sends stdin and waits for the CLI to finish', async ({ processes }) => {
  const result = await processes.run({ executable, args: ['sum', '--stdin'], stdin: '-12.5 2.5\n', timeoutMs: 5_000 });

  expect(result.exitCode).toBe(0);
  assertComparison(compareJson(JSON.parse(result.stdout.bytes.toString('utf8')), {
    schemaVersion: 1, operation: 'sum', operands: [-12.5, 2.5], sum: -10,
  }));
});

test('preserves the expected nonzero exit and diagnostic for bad input', async ({ processes }) => {
  const result = await processes.run({
    executable, args: ['sum', '--a', '1x', '--b', '2'], expectedExitCodes: [2], timeoutMs: 5_000,
  });

  expect(result.exitCode).toBe(2);
  expect(result.stdout.bytes.byteLength).toBe(0);
  expect(result.stderr.bytes.toString('utf8')).toContain('unexpected characters in number');
});
