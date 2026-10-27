import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { ApplicationService, LocalProcessRunner, PredicateReadiness, ProcessWorkspace } from '../../src/index.ts';
import type { ProcessOptions, ProcessSession } from '../../src/index.ts';

test('workspace service readiness observes a real HTTP endpoint and isolates its working directory', async () => {
  const workspace = await ProcessWorkspace.create();
  let port = 0;
  try {
    const service = await workspace.startService({
      process: { executable: process.execPath, args: ['-e', `
const http=require('node:http'),fs=require('node:fs');
let ready=false;setTimeout(()=>{ready=true},150);
const server=http.createServer((request,response)=>{response.statusCode=ready?200:503;response.end('ready')});
server.listen(0,'127.0.0.1',()=>{fs.writeFileSync('service-state.txt','owned');process.stdout.write('port:'+server.address().port)});
`], killGraceMs: 10 },
      startupTimeoutMs: 3000,
      pollIntervalMs: 10,
      readiness: new PredicateReadiness(async ({ session, signal }) => {
        const match = /port:(\d+)/u.exec(session.stdout.bytes.toString());
        if (match === null) return false;
        port = Number(match[1]);
        return (await fetch(`http://127.0.0.1:${port}/health`, { signal })).status === 200;
      }),
    });
    expect(port).toBeGreaterThan(0);
    await expect(access(join(workspace.directory, 'service-state.txt'))).resolves.toBeUndefined();
    service.assertHealthy();
    await service.stop();
    service.assertHealthy();
  } finally { await workspace.dispose(); }
  await expect(access(workspace.directory)).rejects.toThrow();
});

test('service readiness rejects even a zero exit before readiness', async () => {
  await expect(ApplicationService.start({
    process: { executable: process.execPath, args: ['-e', 'process.exit(0)'], killGraceMs: 10 },
    readiness: new PredicateReadiness(() => false), startupTimeoutMs: 1000,
  })).rejects.toMatchObject({ code: 'PROCESS_EXIT_FAILED', result: expect.objectContaining({ exitCode: 0 }) });
});

test('a noncooperative readiness probe cannot exceed its deadline or retain the owned process', async () => {
  let pid = 0;
  let signal: AbortSignal | undefined;
  const started = Date.now();
  await expect(ApplicationService.start({
    process: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], killGraceMs: 10 },
    startupTimeoutMs: 100,
    readiness: new PredicateReadiness(context => {
      pid = context.session.pid;
      signal = context.signal;
      return new Promise<boolean>(() => {});
    }),
  })).rejects.toMatchObject({ code: 'PROCESS_TIMED_OUT' });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(signal?.aborted).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
});

test('service readiness responds to caller cancellation and stops its actual child', async () => {
  const controller = new AbortController();
  let pid = 0;
  const result = ApplicationService.start({
    process: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], signal: controller.signal, killGraceMs: 10 },
    startupTimeoutMs: 3000,
    readiness: new PredicateReadiness(context => {
      pid = context.session.pid;
      controller.abort();
      return false;
    }),
  });
  await expect(result).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
  expect(() => process.kill(pid, 0)).toThrow();
});

test('workspace disposal reports a service that crashed after readiness', async () => {
  const workspace = await ProcessWorkspace.create();
  const service = await workspace.startService({
    process: { executable: process.execPath, args: ['-e', "process.stdout.write('ready');setTimeout(()=>process.exit(7),150)"], killGraceMs: 10 },
    readiness: new PredicateReadiness(({ session }) => session.stdout.bytes.toString().includes('ready')),
    pollIntervalMs: 10, startupTimeoutMs: 3000,
  });
  expect((await service.result).exitCode).toBe(7);
  expect(() => service.assertHealthy()).toThrow('Service exited before owned shutdown');
  await expect(workspace.dispose()).rejects.toThrow('Application service failed before owned shutdown');
  await expect(access(workspace.directory)).rejects.toThrow();
});

test('invalid service budgets cannot create a process', async () => {
  class CountingRunner extends LocalProcessRunner {
    calls = 0;
    override start(options: ProcessOptions): Promise<ProcessSession> { this.calls++; return super.start(options); }
  }
  const runner = new CountingRunner();
  await expect(ApplicationService.start({
    process: { executable: process.execPath }, startupTimeoutMs: 0,
    readiness: new PredicateReadiness(() => true),
  }, runner)).rejects.toThrow('startupTimeoutMs');
  expect(runner.calls).toBe(0);
});

test('workspace disposal cancels an observed pending readiness loop', async () => {
  const workspace = await ProcessWorkspace.create();
  const pending = workspace.startService({
    process: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], killGraceMs: 10 },
    readiness: new PredicateReadiness(() => false),
    startupTimeoutMs: 3000,
  }).catch((cause: unknown) => cause);
  await delay(50);
  await workspace.dispose();
  expect(await pending).toMatchObject({ code: 'PROCESS_ABORTED' });
});
