import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineEngine, EngineError, type Engine } from '../../src/engine/index.ts';
import { createEngineSession } from '../../src/engine/session.ts';
import { expect as expectFixture } from '../../src/expect/index.ts';
import { Deadline, withTimeout } from '../../src/internal/time.ts';
import { LocatorEngine } from '../../src/locator/engine.ts';
import { createScreen } from '../../src/locator/screen.ts';
import { AttemptBudget } from '../../src/run/budget.ts';
import { StepRecorder } from '../../src/run/steps.ts';
import { snapshot } from '../helpers/snapshot.ts';

const resultNode = { ref: { id: 'result', revision: '' }, role: 'status' as const, text: '83.50' };

function resultLocator(locate: NonNullable<Engine['locate']>) {
  const engine = defineEngine({ name: 'deadline-test', version: '1', spiVersion: 1, observe: async () => snapshot([resultNode]), locate });
  return createScreen({
    engine: new LocatorEngine({
      session: createEngineSession({ targetName: 'test', engine }),
      budget: new AttemptBudget(new AbortController().signal, new Deadline(5_000)),
      runId: 'run', attemptId: 'attempt', actionTimeout: 1_000, assertionTimeout: 350,
    }),
    steps: new StepRecorder('attempt'),
    secrets: { async resolve() { throw new Error('No secrets in this fixture'); } },
  }).getByTestId('result');
}

afterEach(() => vi.useRealTimers());

describe('locator assertion polling deadline', () => {
  it('reports the last observed mismatch without sending an expired backend request', async () => {
    vi.useFakeTimers();
    const budgets: number[] = [];
    const locator = resultLocator(async (_expression, operation) => {
      budgets.push(operation.timeoutMs);
      return withTimeout(
        new Promise<(typeof resultNode)[]>((resolve) => setTimeout(() => resolve([resultNode]), 5)),
        operation.timeoutMs,
        () => new EngineError('OPERATION_TIMEOUT', 'backend request timed out', { retryable: false }),
      );
    });
    const assertion = expect(expectFixture(locator).toHaveText('82.50')).rejects.toMatchObject({
      code: 'ASSERTION_FAILED',
      details: { observed: 'text "83.50"', expected: 'text "82.50"', matches: 1 },
    });
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
    expect(budgets).toEqual([350, 245, 140, 35]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['OPERATION_TIMEOUT', 'ENGINE_FAILURE', 'NODE_STALE'] as const)(
    'preserves a genuine %s after an earlier mismatching sample',
    async (code) => {
      vi.useFakeTimers();
      const cause = new EngineError(code, 'backend failed during an active operation', { retryable: false });
      let calls = 0;
      const locator = resultLocator(async () => {
        if (++calls === 2) throw cause;
        return [resultNode];
      });
      const expectedCode = { OPERATION_TIMEOUT: 'ACTION_FAILED', ENGINE_FAILURE: 'ENGINE_FAILURE', NODE_STALE: 'LOCATOR_NOT_FOUND' }[code];
      const assertion = expect(expectFixture(locator).toHaveText('82.50')).rejects.toMatchObject({ code: expectedCode, cause });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    },
  );

  it.each([false, true])('retains a failed assertion when its final read exhausts the budget (negated: %s)', async (negated) => {
    vi.useFakeTimers();
    let calls = 0;
    const locator = resultLocator(async (_expression, operation) => {
      if (++calls === 1) return [resultNode];
      return new Promise<never>((_resolve, reject) => setTimeout(() => reject(
        new EngineError('OPERATION_TIMEOUT', 'read exhausted the remaining budget', { retryable: false }),
      ), operation.timeoutMs));
    });
    const expectation = expectFixture(locator, '[oracle:calculation]');
    const assertion = expect((negated ? expectation.not : expectation).toHaveText('82.50')).rejects.toMatchObject({
      code: 'ASSERTION_FAILED', message: expect.stringContaining('[oracle:calculation]'),
      details: { observed: 'text "83.50"', matches: 1 },
    });
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
    expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not replace an initial read timeout with an unobserved mismatch', async () => {
    vi.useFakeTimers();
    const locator = resultLocator(async (_expression, operation) => new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new EngineError('OPERATION_TIMEOUT', 'no observation', { retryable: false })), operation.timeoutMs);
    }));
    const assertion = expect(expectFixture(locator).toHaveText('82.50')).rejects.toMatchObject({ code: 'ACTION_FAILED' });
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });

  it('preserves an engine failure even when it arrives at the assertion deadline', async () => {
    vi.useFakeTimers();
    const cause = new EngineError('ENGINE_FAILURE', 'engine disconnected', { retryable: false });
    let calls = 0;
    const locator = resultLocator(async (_expression, operation) => {
      if (++calls === 1) return [resultNode];
      return new Promise<never>((_resolve, reject) => setTimeout(() => reject(cause), operation.timeoutMs));
    });
    const assertion = expect(expectFixture(locator).toHaveText('82.50')).rejects.toMatchObject({ code: 'ENGINE_FAILURE', cause });
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });
});
