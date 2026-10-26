import { test } from '@e2e-platform/playwright';

test.skip('bare skip without a reason', async () => {});

test('skip with a reason', { skip: 'waiting on the payments sandbox' }, async () => {});
