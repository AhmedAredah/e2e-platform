import { test, expect } from '@e2e-platform/process/test';
import { withCppService } from '../http-test-support.ts';

test('rejects the planted wrong C++ HTTP result despite status 200', async ({ processes }) => {
  await withCppService(processes, true, async (client) => {
    const actual = (await client.get('/sum?a=1.5&b=2.5')).expectStatus(200).json() as { sum: number };
    expect(actual.sum).toBe(4);
  });
});
