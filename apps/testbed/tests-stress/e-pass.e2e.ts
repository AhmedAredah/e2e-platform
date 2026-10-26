import { test } from '@e2e-platform/playwright';
import { expect } from '@e2e-platform/core';

test('first passing test', async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByRole('heading', { name: 'Playground' })).toBeVisible();
});

test('second passing test', async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByRole('link', { name: 'Todos' })).toBeVisible();
});
