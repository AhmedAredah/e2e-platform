import { test } from '@e2e-platform/agent-device';
import { expect } from '@e2e-platform/core';

test('Settings opens', async ({ screen }) => {
  await expect(screen.getByRole('button', { name: 'General' })).toBeVisible();
});
