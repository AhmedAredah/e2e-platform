import { test } from '@e2e-platform/agent-device';
import { expect } from '@e2e-platform/core';

test('the agent opens General', async ({ agent, device }) => {
  await agent.act('open {section} settings', { params: { section: 'General' } });

  await agent.assert('the General settings screen is showing');
  await expect(device.locator('role=NavigationBar id=General')).toBeVisible();
});
