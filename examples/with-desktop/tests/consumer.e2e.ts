import { test, expect } from '@e2e-platform/core';

test('installed desktop consumer validates application output', async ({ app, screen }) => {
  await app.open();
  const backend = process.env['E2E_DESKTOP_BACKEND'];
  const input = backend === 'linux-atspi'
    ? screen.getByRole('textbox', { name: 'Name', exact: true }) : screen.getByTestId('input');
  await input.fill('E2E café');
  const submit = backend === 'linux-atspi'
    ? screen.getByRole('button', { name: 'Submit', exact: true })
    : screen.getByTestId(backend === 'macos-ax' ? 'apply' : 'submit');
  await submit.click();
  if (backend === 'linux-atspi') {
    await expect(screen.getByRole('text', { name: 'Result', exact: true }), '[oracle:desktop-output]').toHaveText('Hello E2E café');
  } else if (backend === 'macos-ax') {
    await expect(screen.getByTestId('echo'), '[oracle:desktop-output]').toHaveValue('E2E café');
  } else {
    await expect(screen.getByTestId('result'), '[oracle:desktop-output]').toHaveText('E2E café');
    await screen.getByTestId('load-choice').click();
    await screen.getByTestId('delayed-choice').selectOption('Later');
    await expect(screen.getByTestId('selection-result')).toHaveText('Later');
  }
});
