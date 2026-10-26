/** Late engine faults must settle before a completed flow confirms its cache. */
import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '../../src/engine/index.ts';
import type { TraceCacheStore } from '../../src/cache/store.ts';
import { nodeIdFor } from '../helpers/fake-loop-model.ts';
import { assertValidReport } from '../helpers/report-schema.ts';
import { createProject, runExisting } from '../helpers/run-project.ts';

const builtEngine = '../../dist/engine/index.js';
const { defineEngine, EngineError, resolveExpression } = await import(builtEngine) as typeof import('../../src/engine/index.ts');
const appUrl = 'http://127.0.0.1:4599';

/** Uses actual harness actions and assertions so a passing control creates traces. */
function suite(serial: boolean): string {
  const member = (title: string) => `test('${title}', async ({ agent, screen }) => {
    await agent.act('tap Submit');
    await expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
  });`;
  return `import { test, expect } from '@e2e-platform/core';\n${serial
    ? `test.describe('shared flow', { serial: true }, () => { ${member('first')} ${member('second')} });`
    : member('first')}`;
}

describe('engine cleanup and trace confirmation', () => {
  it.each([
    { serial: false, fault: 'none' }, { serial: false, fault: 'settle' },
    { serial: true, fault: 'none' }, { serial: true, fault: 'settle' },
    { serial: false, fault: 'cleanup' }, { serial: true, fault: 'cleanup' },
  ] as const)('settles before cache writes (serial: $serial, fault: $fault)', async ({ serial, fault }) => {
    const project = createProject({ 'tests/cache.e2e.ts': suite(serial) });
    let closed = false;
    let reported = false;
    let actions = 0;
    const writes: { key: string; afterClose: boolean }[] = [];
    const deleted: string[] = [];
    const store: TraceCacheStore = {
      writable: true,
      async read() { return { status: 'miss' }; },
      async write(key) { writes.push({ key, afterClose: closed }); return { bytes: 1 }; },
      async delete(key) { deleted.push(key); },
    };
    const root: SemanticNode = {
      ref: { id: 'root', revision: '' }, role: 'window',
      children: [{ ref: { id: 'submit', revision: '' }, role: 'button', name: 'Submit', states: { hidden: false } }],
    };
    const engine = defineEngine({
      name: 'cleanup-cache-test', version: '1', spiVersion: 1, platform: 'desktop',
      app: { url: appUrl }, actions: ['tap'],
      async observe() { return { location: `${appUrl}/`, root, viewport: { width: 100, height: 100 } }; },
      async locate(expression) { return resolveExpression(expression, [root]); },
      async perform() { actions++; },
      async endAttempt() {
        closed = true;
        if (fault === 'cleanup') throw new EngineError('ENGINE_FAILURE', 'resource cleanup failed', { retryable: false });
      },
      async settleAttempt() {
        if (fault === 'settle' && closed && !reported) {
          reported = true;
          throw new EngineError('ENGINE_FAILURE', 'transport failed during cleanup', { retryable: false });
        }
      },
    });
    try {
      const outcome = await runExisting(project, {
        appUrl,
        config: {
          targets: [{ engine }], modelPolicy: 'forbid', artifacts: [],
          cache: { mode: 'read-write', store },
          agents: { default: {
            name: 'deterministic-tap', version: '1',
            async runStep(context) {
              const observation = await context.observe();
              await context.actions.tap({ id: nodeIdFor(observation.text, /button "Submit"/) });
              return { status: 'passed', summary: 'Submitted' };
            },
          } },
        },
      });
      const count = serial ? 2 : 1;
      expect(actions).toBe(count);
      expect(closed).toBe(true);
      assertValidReport(outcome.report);
      if (fault !== 'none') {
        expect(outcome.exitCode, JSON.stringify(outcome.report)).not.toBe(0);
        expect(reported).toBe(fault === 'settle');
        expect(writes).toEqual([]);
        expect(deleted).toHaveLength(count);
        const attempt = serial ? outcome.report.run.serialGroups[0]?.attempts[0] : outcome.results[0]?.attempts[0];
        expect(attempt?.cleanup).toBe('failed');
        expect(attempt?.secondaryErrors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ENGINE_FAILURE' })]));
        if (fault === 'settle') {
          expect(attempt?.status).toBe('failed');
          expect(attempt?.error?.code).toBe('ENGINE_FAILURE');
        }
      } else {
        expect(outcome.exitCode, JSON.stringify(outcome.report)).toBe(0);
        expect(writes).toHaveLength(count);
        expect(writes.every((write) => write.afterClose)).toBe(true);
        expect(deleted).toEqual([]);
      }
    } finally { project.cleanup(); }
  });
});
