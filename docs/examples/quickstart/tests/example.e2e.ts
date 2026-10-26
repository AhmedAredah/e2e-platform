import { test } from '@e2e-cpp/playwright';
import { expect } from '@e2e-cpp/core';

test('app opens', async ({ app, web }) => {
  await app.open('/');
  await expect(web.locator('body')).toBeVisible();
});
