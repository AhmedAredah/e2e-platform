import { expect, test } from 'vitest';
import type { FixtureContext, TestFixtures } from '@e2e-platform/core';
import type { ProcessFixture, ProcessOutput, ProcessResult, ProcessSession } from '@e2e-platform/process';
import { AuthoredTestHost } from '../src/host.ts';

/** Simulates a child receiving its response before the supervisor acknowledges the write. */
test('serializes response writes when the next request arrives before write acknowledgement', async () => {
  const request = (id: number): Buffer => Buffer.from(JSON.stringify({ protocol: 2, id, method: id === 1 ? 'case.start' : id === 3 ? 'case.complete' : 'expect.true', params: id === 1 ? { name: 'write ordering' } : id === 3 ? {} : { actual: true } }) + '\n');
  const capture = { bytes: Buffer.alloc(0), totalBytes: 0, truncated: false };
  const completed: ProcessResult = { executable: 'fixture', args: [], cwd: '.', pid: 1, status: 'exited', exitCode: 0, signal: null, durationMs: 1, stdout: capture, stderr: capture };
  let finish: (result: ProcessResult) => void = () => {};
  const result = new Promise<ProcessResult>(resolve => { finish = resolve; });
  let listener: ((event: ProcessOutput) => void) | undefined;
  let writing = false;
  let writes = 0;
  const child: ProcessSession = {
    pid: 1, result, stdout: { ...capture, bytes: request(1) }, stderr: capture,
    async write() {
      if (writing) throw new Error('Overlapping supervisor writes');
      writing = true; writes++;
      if (writes < 3) queueMicrotask(() => listener?.({ stream: 'stdout', bytes: request(writes + 1) }));
      await new Promise(resolve => setTimeout(resolve, 10));
      writing = false;
      if (writes === 3) finish(completed);
    },
    async closeInput() {},
    async stop() { finish(completed); return completed; },
    onOutput(callback) { listener = callback; return () => { listener = undefined; }; },
  };
  const fixtures = { processes: { start: async () => child } } as unknown as TestFixtures & { processes: ProcessFixture };
  const context = { signal: new AbortController().signal, fixture: (_name: string, resource: unknown) => resource } as unknown as FixtureContext;
  await new AuthoredTestHost(fixtures, context).run({ executable: 'fixture' }, 'write ordering');
  expect(writes).toBe(3);
});
