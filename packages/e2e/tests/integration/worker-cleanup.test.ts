/** Engine disposal, quarantine and setup gating through the real runner. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resultByTitle, runProject, runProjectWithConfigFile } from '../helpers/run-project.ts';
import { assertValidReport } from '../helpers/report-schema.ts';

const engineModule = '../../dist/engine/index.js';
const { defineEngine, EngineError } = await import(engineModule) as typeof import('../../src/engine/index.ts');
const base = { name: 'cleanup-fixture', version: '1', spiVersion: 1, platform: 'desktop' } as const;
const PASSING_TEST = `import { test } from '@e2e-cpp/core'; test('passes', () => {});`;

/** A real child-worker config; disposal never runs in the parent process. */
function disposalConfig(body: string, cleanupTimeout: number): string {
  return `import { writeFileSync } from 'node:fs';
import { defineEngine } from '@e2e-cpp/core/engine';
export default { workers: 1, cleanupTimeout: ${cleanupTimeout}, artifacts: [], modelPolicy: 'forbid', cache: 'off', reporters: [],
  targets: [{ engine: defineEngine({ name: 'disposal', version: '1', spiVersion: 1, platform: 'desktop', async dispose() { ${body} } }) }] };`;
}

describe('worker disposal', () => {
  it.each([
    ['throw', `throw new Error('disposal failed');`, 'ENGINE_FAILURE'],
    ['hang', `await new Promise(() => {});`, 'CLEANUP_TIMEOUT'],
    ['exit', `process.exit(9);`, 'WORKER_EXIT'],
  ])('cannot pass after disposal %s', async (_label, body, code) => {
    const { outcome, project } = await runProjectWithConfigFile({ 'tests/a.e2e.ts': PASSING_TEST }, {
      appUrl: '', configSource: disposalConfig(body!, 150),
    });
    try {
      expect(resultByTitle(outcome, 'passes').status).toBe('passed');
      expect(outcome.exitCode).toBe(3);
      expect(outcome.report.run.errors.some((error) => error.code === code)).toBe(true);
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it('allows acknowledged disposal beyond the old ten-second limit', async () => {
    const { outcome, project } = await runProjectWithConfigFile({ 'tests/a.e2e.ts': PASSING_TEST }, {
      appUrl: '', configSource: disposalConfig(`await new Promise((resolve) => setTimeout(resolve, 10_500)); writeFileSync('disposed.txt', 'complete');`, 15_000),
    });
    try {
      expect(outcome.exitCode).toBe(0);
      expect(outcome.report.run.errors).toEqual([]);
      expect(readFileSync(path.join(project.dir, 'disposed.txt'), 'utf8')).toBe('complete');
    } finally { project.cleanup(); }
  }, 25_000);
});

describe('failed attempt cleanup', () => {
  it('does not retry or reuse failed cleanup after a retryable launch failure', async () => {
    let starts = 0;
    let initializations = 0;
    const engine = defineEngine({ ...base,
      async init() { initializations++; },
      async startAttempt() {
        starts++;
        if (starts === 1) throw new EngineError('NOT_ACTIONABLE', 'launch surface unavailable', { retryable: true });
      },
      async endAttempt() {
        if (starts === 1) throw new EngineError('ENGINE_FAILURE', 'launch cleanup failed', { retryable: false });
      },
    });
    const { outcome, project } = await runProject({
      'tests/a.e2e.ts': `import { test } from '@e2e-cpp/core'; test('first', () => {}); test('same file', () => {});`,
      'tests/b.e2e.ts': `import { test } from '@e2e-cpp/core'; test('independent', () => {});`,
    }, { appUrl: '', config: { targets: [{ engine }], retries: 2, artifacts: [], modelPolicy: 'forbid', reporters: [] } });
    try {
      expect(outcome.exitCode).toBe(3);
      expect(resultByTitle(outcome, 'first').attempts).toHaveLength(1);
      expect(resultByTitle(outcome, 'same file').status).toBe('skipped');
      expect(resultByTitle(outcome, 'independent').status).toBe('passed');
      expect(outcome.report.run.errors.some((error) => error.phase === 'cleanup' && error.message === 'launch cleanup failed')).toBe(true);
      expect(starts).toBe(2);
      expect(initializations).toBe(2);
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it.each(['ordinary', 'serial', 'serial-settle', 'failed-body'] as const)('quarantines %s work and reinitializes for the next file', async (kind) => {
    const events: string[] = [];
    let attempts = 0;
    let closed = false;
    const engine = defineEngine({ ...base,
      async init() { events.push('init'); },
      async dispose() { events.push('dispose'); },
      async startAttempt() { attempts++; closed = false; events.push(`start:${attempts}`); },
      async endAttempt() {
        closed = true;
        events.push(`end:${attempts}`);
        if (attempts === 1 && kind !== 'serial-settle') throw new EngineError('ENGINE_FAILURE', 'cannot close attempt', { retryable: false });
      },
      async settleAttempt() {
        if (attempts === 1 && closed && kind === 'serial-settle') throw new EngineError('ENGINE_FAILURE', 'late shared fault', { retryable: false });
      },
    });
    const first = `test('first', () => { ${kind === 'failed-body' ? "throw new Error('product failure');" : ''} });`;
    const suite = kind.startsWith('serial') ? `test.describe('flow', { serial: true }, () => { ${first} test('member', () => {}); });` : first;
    const { outcome, project } = await runProject({
      'tests/a.e2e.ts': `import { test } from '@e2e-cpp/core'; ${suite} test('same file', () => { throw new Error('must not run'); });`,
      'tests/b.e2e.ts': `import { test } from '@e2e-cpp/core'; test('independent', () => {});`,
    }, { appUrl: '', config: { targets: [{ engine }], retries: 2, artifacts: [], modelPolicy: 'forbid', reporters: ['junit'] } });
    try {
      expect(outcome.exitCode).toBe(3);
      expect(resultByTitle(outcome, 'same file')).toMatchObject({ status: 'skipped', skip: { cause: 'infrastructure-unavailable' } });
      expect(resultByTitle(outcome, 'independent').status).toBe('passed');
      expect(events).toEqual(['init', 'start:1', 'end:1', 'dispose', 'init', 'start:2', 'end:2', 'dispose']);
      expect(outcome.results).toHaveLength(kind.startsWith('serial') ? 4 : 3);
      expect(readFileSync(path.join(project.dir, '.e2e', 'junit.xml'), 'utf8')).toContain('errors="1"');
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });

  it('does not publish a session from setup with failed cleanup; unrelated work still runs', async () => {
    let attempts = 0;
    let restores = 0;
    let initializations = 0;
    const engine = defineEngine({ ...base,
      async init() { initializations++; },
      async startAttempt() { attempts++; },
      async endAttempt() { if (attempts === 1) throw new EngineError('ENGINE_FAILURE', 'setup cleanup failed', { retryable: false }); },
      state: {
        async capture() { return { format: 'fixture', version: 1, data: { seeded: true } }; },
        async restore() { restores++; },
      },
    });
    const { outcome, project } = await runProject({
      'tests/a.e2e.ts': `import { test } from '@e2e-cpp/core';
        test.setup('seed', { sessions: ['seeded'] }, async ({ session }) => { await session.save('seeded'); });
        test('dependent', { session: 'seeded' }, () => { throw new Error('must not run'); });
        test('unrelated', () => {});`,
    }, { appUrl: '', config: { targets: [{ engine }], artifacts: [], modelPolicy: 'forbid', reporters: [] } });
    try {
      expect(outcome.exitCode).toBe(3);
      expect(resultByTitle(outcome, 'dependent')).toMatchObject({ status: 'skipped', skip: { cause: 'setup-failed' } });
      expect(resultByTitle(outcome, 'unrelated').status).toBe('passed');
      expect(restores).toBe(0);
      expect(initializations).toBe(2);
      expect(attempts).toBe(2);
      assertValidReport(outcome.report);
    } finally { project.cleanup(); }
  });
});
