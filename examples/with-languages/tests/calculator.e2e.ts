import { test, expect } from '@e2e-cpp/process/test';
import { applicationProfile } from '../support/profiles.ts';
import { checkCalculation } from '../support/oracle.ts';
import { withService } from '../support/service.ts';

test('CLI returns independently checked arithmetic', async ({ processes, platform }) => {
  const launch = applicationProfile(platform).resolve(['sum', '0.1', '0.2']);
  const result = await processes.run({ ...launch.process, timeoutMs: 5_000 });
  expect(result.stderr.bytes.byteLength).toBe(0);
  checkCalculation(JSON.parse(result.stdout.bytes.toString('utf8')));
});

test('CLI rejects malformed operands with a nonzero exit', async ({ processes, platform }) => {
  const launch = applicationProfile(platform).resolve(['sum', 'not-a-number', '2']);
  const result = await processes.run({ ...launch.process, timeoutMs: 5_000, expectedExitCodes: [2] });
  expect(result.exitCode).toBe(2);
  expect(result.stdout.bytes.byteLength).toBe(0);
  expect(result.stderr.bytes.byteLength).toBeGreaterThan(0);
});

test('HTTP returns checked arithmetic and rejects malformed requests', async ({ processes, platform }) => {
  await withService(processes, applicationProfile(platform), false, async (client) => {
    checkCalculation((await client.get('/sum?a=0.1&b=0.2')).expectStatus(200).json());
    (await client.get('/sum?a=not-a-number&b=2')).expectStatus(400);
    (await client.get('/sum?a=0.1&b=0.2&garbage')).expectStatus(400);
    (await client.get('/sum?a=0.1&b=0.2&a=3')).expectStatus(400);
  });
});
