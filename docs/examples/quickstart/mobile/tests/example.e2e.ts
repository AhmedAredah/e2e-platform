import { test } from '@e2e-cpp/agent-device';
import { expect } from '@e2e-cpp/core';

test('Settings opens', async ({ screen }) => {
  await expect(screen.getByRole('button', { name: 'General' })).toBeVisible();
});
