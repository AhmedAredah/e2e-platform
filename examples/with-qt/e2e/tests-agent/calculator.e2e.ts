import { test, expect } from '@e2e-platform/core';

test('calculates a project from a natural-language goal', async ({ app, agent, screen }) => {
  await app.open();
  await agent.act('Set Quantity to 6 and Unit price to 12.5. Include 10% tax. Click Calculate and wait for the total.');
  await expect(screen.getByTestId('result')).toHaveText('Total: 82.50 USD');
});
