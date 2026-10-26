import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { withService } from '../../examples/with-languages/support/service.ts';

/** A real loopback health endpoint with injected process cleanup outcomes. */
async function serviceFixture(context, stop) {
  const server = createServer((_request, response) => { response.writeHead(200, {'content-type': 'application/json'}); response.end('{"ok":true}'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const capture = bytes => ({bytes, truncated: false, totalBytes: bytes.length});
  const child = {
    stdout: capture(Buffer.from(`E2E_LANGUAGE_READY {"port":${server.address().port}}\n`)),
    stderr: capture(Buffer.alloc(0)),
    result: new Promise(() => {}),
    stop,
  };
  return {processes: {start: async () => child}, profile: {resolve: () => ({process: {executable: 'fixture'}})}};
}

test('preserves the primary assertion when cleanup succeeds', async context => {
  const failure = new Error('primary assertion');
  const fixture = await serviceFixture(context, async () => ({status: 'stopped'}));
  await assert.rejects(withService(fixture.processes, fixture.profile, false, async () => {throw failure;}), error => error === failure);
});

test('retains both primary and cleanup failures', async context => {
  const primary = new Error('primary assertion');
  const cleanup = new Error('cleanup failed');
  const fixture = await serviceFixture(context, async () => {throw cleanup;});
  await assert.rejects(withService(fixture.processes, fixture.profile, false, async () => {throw primary;}), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanup]);
    assert.equal(error.cause, cleanup);
    return true;
  });
});

test('fails a successful request if service cleanup fails', async context => {
  const cleanup = new Error('cleanup failed');
  const fixture = await serviceFixture(context, async () => {throw cleanup;});
  await assert.rejects(withService(fixture.processes, fixture.profile, false, async () => 'ok'), error => error === cleanup);
});
