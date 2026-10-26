import { rejects } from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@e2e-platform/core';

test('imports a project, edits its data, computes asynchronously, and exports', async ({ app, screen }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'e2e-qt-example-'));
  try {
    const input = path.join(directory, 'input.csv');
    const output = path.join(directory, 'result.json');
    await writeFile(input, 'quantity,price\n4,12.5\n');
    await app.open();
    await screen.getByTestId('input-path').fill(input);
    await screen.getByTestId('import').click();
    await expect(screen.getByTestId('status')).toHaveText('Imported');
    await expect(screen.getByTestId('quantity')).toHaveValue('4');
    await screen.getByTestId('quantity').fill('6');
    await screen.getByTestId('currency').selectOption({ label: 'EUR' });
    await screen.getByTestId('tax').check();
    await screen.getByTestId('calculate').click();
    await expect(screen.getByTestId('result')).toHaveText('Total: 82.50 EUR');
    await expect(screen.getByTestId('status')).toHaveText('Calculated');
    await screen.getByTestId('output-path').fill(output);
    await screen.getByTestId('export').click();
    await expect(screen.getByTestId('status')).toHaveText('Exported');
    const result: unknown = JSON.parse(await readFile(output, 'utf8'));
    if (result === null || typeof result !== 'object' || !('total' in result) || !('currency' in result)
      || result.total !== 82.5 || result.currency !== 'EUR') throw new Error('Exported numerical result is incorrect');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid numbers and accepts Unicode paths as text', async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('input-path').fill('مشروع café.csv');
  await expect(screen.getByTestId('input-path')).toHaveValue('مشروع café.csv');
  await screen.getByTestId('quantity').fill('invalid');
  await screen.getByTestId('calculate').click();
  await expect(screen.getByTestId('status')).toHaveText('Invalid numbers');
});

test('rejects nonfinite input and overflow before writing JSON', async ({ app, screen }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'e2e-qt-invalid-'));
  const output = path.join(directory, 'result.json');
  try {
    await app.open();
    await screen.getByTestId('output-path').fill(output);
    await screen.getByTestId('export').click();
    await expect(screen.getByTestId('status')).toHaveText('No valid calculation');
    await rejects(access(output), { code: 'ENOENT' });
    for (const value of ['nan', 'inf']) {
      await screen.getByTestId('quantity').fill(value);
      await screen.getByTestId('calculate').click();
      await expect(screen.getByTestId('status')).toHaveText('Invalid numbers');
      await screen.getByTestId('export').click();
      await expect(screen.getByTestId('status')).toHaveText('No valid calculation');
      await rejects(access(output), { code: 'ENOENT' });
    }
    await screen.getByTestId('quantity').fill('1e308');
    await screen.getByTestId('unit-price').fill('1e308');
    await screen.getByTestId('calculate').click();
    await expect(screen.getByTestId('status')).toHaveText('Invalid numbers');
    await screen.getByTestId('export').click();
    await expect(screen.getByTestId('status')).toHaveText('No valid calculation');
    await rejects(access(output), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
