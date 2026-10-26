import type { ApplicationLaunchProfile, ProcessFixture, ProcessSession } from '@e2e-cpp/process';
import { createHttpClient, type HttpClient } from '@e2e-cpp/protocol';

/** Waits for one bounded, strictly parsed loopback readiness announcement. */
async function readyPort(child: ProcessSession): Promise<number> {
  const deadline = Date.now() + 5_000;
  let finished = false;
  void child.result.then(() => { finished = true; }, () => { finished = true; });
  while (Date.now() < deadline) {
    if (child.stdout.truncated || child.stderr.truncated) throw new Error('Application startup output exceeded the capture budget');
    const lines = child.stdout.bytes.toString('utf8').split('\n');
    lines.pop();
    for (const line of lines) {
      if (!line.startsWith('E2E_LANGUAGE_READY ')) continue;
      const payload = JSON.parse(line.slice('E2E_LANGUAGE_READY '.length)) as { port?: unknown };
      if (!Number.isInteger(payload.port) || (payload.port as number) < 1 || (payload.port as number) > 65535) throw new Error('Invalid application readiness port');
      return payload.port as number;
    }
    if (finished) throw new Error('Application exited before HTTP readiness');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Application did not become ready within 5000 ms');
}

/** Owns startup, requests and teardown, including when a deliberately wrong result fails an assertion. */
export async function withService<T>(processes: ProcessFixture, profile: ApplicationLaunchProfile, wrong: boolean, body: (client: HttpClient) => Promise<T>): Promise<T> {
  const launch = profile.resolve(['serve', ...(wrong ? ['--wrong-result'] : [])]);
  const child = await processes.start({ ...launch.process, timeoutMs: 15_000, maxOutputBytes: 64 * 1024, killGraceMs: 500, drainTimeoutMs: 1000 });
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const port = await readyPort(child);
    const client = createHttpClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2_000, maxResponseBytes: 4096 });
    (await client.get('/health')).expectStatus(200);
    outcome = { ok: true, value: await body(client) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    const stopped = await child.stop();
    if (stopped.ioError !== undefined) throw stopped.ioError;
    if (stopped.status !== 'stopped' && !(stopped.status === 'exited' && stopped.exitCode === 0)) throw new Error(`Unexpected service termination: ${stopped.status}`);
  } catch (cleanupError) {
    if (!outcome.ok) throw new AggregateError([outcome.error, cleanupError], 'Application operation and service cleanup both failed', { cause: cleanupError });
    throw cleanupError;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
