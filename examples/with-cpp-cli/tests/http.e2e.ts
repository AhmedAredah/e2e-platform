import { test, expect } from '@e2e-platform/process/test';
import { compareJson } from '@e2e-platform/checks';
import { withCppService } from '../http-test-support.ts';

test('C++ HTTP returns independent arithmetic and rejects invalid requests', async ({ processes }) => {
  await withCppService(processes, false, async (client) => {
    const actual = (await client.get('/sum?a=0.1&b=0.2')).expectStatus(200).json();
    expect(compareJson(actual, { schemaVersion: 1, operation: 'sum', operands: [0.1, 0.2], sum: 0.3 }, { numbers: { absolute: 1e-12 } }).matches).toBe(true);
    for (const query of ['a=invalid&b=2', 'a=1&b=2&a=3', 'a=1&b=2&garbage', 'a=nan&b=2', 'a=1e308&b=1e308', 'a=1&b=2&']) {
      (await client.get(`/sum?${query}`)).expectStatus(400);
    }
    (await client.get('/missing')).expectStatus(404);
    (await client.post('/sum?a=1&b=2')).expectStatus(405);
  });
});
