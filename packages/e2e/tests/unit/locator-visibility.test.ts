import { describe, expect, it } from 'vitest';
import { defineEngine, type Engine, type EngineHandle } from '../../src/engine/index.ts';
import { createEngineSession } from '../../src/engine/session.ts';
import { expect as expectFixture } from '../../src/expect/index.ts';
import { Deadline, withTimeout } from '../../src/internal/time.ts';
import { LocatorEngine } from '../../src/locator/engine.ts';
import { createScreen } from '../../src/locator/screen.ts';
import { AttemptBudget } from '../../src/run/budget.ts';
import { StepRecorder } from '../../src/run/steps.ts';
import { snapshot } from '../helpers/snapshot.ts';

const visibleNode = { ref: { id: 'button', revision: '' }, role: 'button' as const, name: 'Visible', states: { hidden: false } };

/** Uses the real session revision adapter so concurrent queries can supersede references. */
function visibilityScreen(engine: EngineHandle) {
  return createScreen({
    engine: new LocatorEngine({
      session: createEngineSession({ targetName: 'test', engine }),
      budget: new AttemptBudget(new AbortController().signal, new Deadline(5_000)),
      runId: 'run', attemptId: 'attempt', actionTimeout: 1000, assertionTimeout: 100,
    }),
    steps: new StepRecorder('attempt'),
    secrets: { async resolve() { throw new Error('No secrets in this fixture'); } },
  });
}

/** A deterministic engine that always reports the same visible button. */
function visibilityEngine(locate: NonNullable<Engine['locate']> = async () => [visibleNode]) {
  return defineEngine({ name: 'visibility', version: '1', spiVersion: 1, observe: async () => snapshot([visibleNode]), locate });
}

describe('locator visibility reads and assertions', () => {
  it('does not pass a hidden assertion when a concurrent query supersedes a visible reference', async () => {
    const locator = visibilityScreen(visibilityEngine()).getByRole('button');
    const assertion = expectFixture(locator).toBeHidden({ timeout: 10 });
    const count = locator.count();
    await expect(Promise.all([assertion, count])).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expect(count).resolves.toBe(1);
  });

  it('does not complete a hidden wait when a concurrent query supersedes a visible reference', async () => {
    const locator = visibilityScreen(visibilityEngine()).getByRole('button');
    await expect(Promise.all([locator.waitFor({ state: 'hidden', timeout: 10 }), locator.count()]))
      .rejects.toMatchObject({ code: 'LOCATOR_NOT_FOUND' });
  });

  it('lets a one-shot visibility read use the normal operation budget', async () => {
    const budgets: number[] = [];
    const screen = visibilityScreen(visibilityEngine(async (_expression, operation) => {
      budgets.push(operation.timeoutMs);
      return withTimeout(new Promise<(typeof visibleNode)[]>((resolve) => setTimeout(() => resolve([visibleNode]), 8)),
        operation.timeoutMs, () => new Error('backend request timed out'));
    }));
    await expect(screen.getByRole('button').isVisible()).resolves.toBe(true);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toBeGreaterThan(8);
    expect(budgets[0]).toBeLessThanOrEqual(1000);
  });

  it('returns false for a genuine zero-match visibility read without waiting for a match', async () => {
    let calls = 0;
    const locator = visibilityScreen(visibilityEngine(async () => { calls++; return []; })).getByRole('button');
    await expect(locator.isVisible()).resolves.toBe(false);
    expect(calls).toBe(1);
    await expectFixture(locator).toBeHidden();
    await locator.waitFor({ state: 'hidden' });
  });
});
