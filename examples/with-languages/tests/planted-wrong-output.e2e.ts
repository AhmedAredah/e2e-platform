import { test } from '@e2e-platform/process/test';
import { applicationProfile } from '../support/profiles.ts';
import { checkCalculation } from '../support/oracle.ts';
import { withService } from '../support/service.ts';

test('rejects the planted CLI wrong result', async ({ processes, platform }) => {
  const launch = applicationProfile(platform).resolve(['sum', '0.1', '0.2', '--wrong-result']);
  const result = await processes.run({ ...launch.process, timeoutMs: 5_000 });
  checkCalculation(JSON.parse(result.stdout.bytes.toString('utf8')));
});

test('rejects the planted HTTP wrong result', async ({ processes, platform }) => {
  await withService(processes, applicationProfile(platform), true, async (client) => {
    checkCalculation((await client.get('/sum?a=0.1&b=0.2')).expectStatus(200).json());
  });
});
