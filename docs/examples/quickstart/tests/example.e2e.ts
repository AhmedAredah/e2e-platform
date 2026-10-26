import { test } from '@e2e-platform/playwright';
import { expect } from '@e2e-platform/core';

test('app opens', async ({ app, web }) => {
  await app.open('/');
  await expect(web.locator('body')).toBeVisible();
});
