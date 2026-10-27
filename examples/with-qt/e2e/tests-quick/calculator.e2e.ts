import { test, expect } from '@e2e-platform/core';

test('drives a Qt Quick calculation through the visual tree', async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('quantity').fill('6');
  await screen.getByTestId('unit-price').fill('12.5');
  await screen.getByTestId('tax').check();
  await screen.getByTestId('currency').selectOption({ value: 'USD' });
  await screen.getByTestId('calculate').click();
  await expect(screen.getByTestId('result'), '[oracle:calculation]').toHaveText('Total: 82.50 USD');
  await expect(screen.getByTestId('status')).toHaveText('Calculated');
});
