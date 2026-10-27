import { describe, expect, it } from 'vitest';
import { runProject, resultByTitle } from '../helpers/run-project.ts';
import { assertValidReport } from '../helpers/report-schema.ts';

/** Extended fixtures use the same recorder without requiring an application engine. */
describe('extended fixture operation context', () => {
  it('records explicitly declared operations and retains ordinary two-argument fixtures', async () => {
    const { outcome, project } = await runProject({
      'tests/context.e2e.ts': `
import { test as base, expect } from '@e2e-platform/core';
const test = base.extend({
  legacy: async (_fixtures, use) => { await use('legacy'); },
  resource: async (_fixtures, use, context) => {
    const resource = context.fixture('resource', {
      async read(value) {
        if (context.signal.aborted || context.operation().signal.aborted) throw new Error('unexpected cancellation');
        return value;
      },
      async verify(value) { expect(value).toBe('expected'); },
    }, {
      read: { kind: 'resource' },
      verify: { kind: 'assertion' },
    });
    await use(resource);
    await resource.read('teardown');
  },
});
test('recorded', async ({ resource, legacy }) => {
  expect(legacy).toBe('legacy');
  await resource.read('do-not-record-argument');
  await resource.verify('expected');
});`,
    }, { appUrl: '', config: { targets: [{ name: 'fixture-only', platform: 'desktop' }], modelPolicy: 'forbid', artifacts: [] } });
    try {
      expect(outcome.exitCode, JSON.stringify(outcome.report)).toBe(0);
      const attempt = resultByTitle(outcome, 'recorded').attempts[0]!;
      expect(attempt.steps.filter((step) => step.api === 'resource.read')).toHaveLength(2);
      expect(attempt.steps.some((step) => step.api === 'resource.verify' && step.kind === 'assertion')).toBe(true);
      expect(JSON.stringify(attempt.steps)).not.toContain('do-not-record-argument');
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it('reports failures and permits recorded operations during teardown after a body timeout', async () => {
    const { outcome, project } = await runProject({
      'tests/context.e2e.ts': `
import { test as base } from '@e2e-platform/core';
const test = base.extend({
  resource: async (_fixtures, use, context) => {
    const resource = context.fixture('resource', {
      async clean() {
        if (context.signal.aborted || context.operation().signal.aborted) throw new Error('stale teardown signal');
      },
    }, { clean: { kind: 'resource' } });
    try { await use(resource); } finally { await resource.clean(); }
  },
});
test('timeout', { timeout: 100 }, async () => { await new Promise(() => {}); });`,
    }, { appUrl: '', config: { targets: [{ name: 'fixture-only', platform: 'desktop' }], modelPolicy: 'forbid', artifacts: [] } });
    try {
      expect(outcome.exitCode).not.toBe(0);
      const result = resultByTitle(outcome, 'timeout');
      expect(result.status).toBe('timed-out');
      expect(result.attempts[0]!.secondaryErrors).toEqual([]);
      expect(result.attempts[0]!.steps.some((step) => step.api === 'resource.clean' && step.status === 'passed')).toBe(true);
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });
});
