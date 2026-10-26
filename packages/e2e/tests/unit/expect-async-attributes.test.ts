import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '../../src/engine/surface.ts';
import { defineEngine, type EngineHandle } from '../../src/engine/index.ts';
import { createEngineSession } from '../../src/engine/session.ts';
import { resolveConfig } from '../../src/config/resolve.ts';
import { expect as expectFixture } from '../../src/expect/index.ts';
import { Deadline } from '../../src/internal/time.ts';
import { AttemptBudget } from '../../src/run/budget.ts';
import { createFixtures } from '../../src/run/fixtures.ts';
import { StepRecorder } from '../../src/run/steps.ts';
import { WorkerModels } from '../../src/run/worker-models.ts';
import { snapshot } from '../helpers/snapshot.ts';

/** Creates a locator fixture backed by one stable semantic node. */
function createAttributeFixture(node: SemanticNode) {
  const engine: EngineHandle = defineEngine({
    name: 'fake',
    version: '1',
    spiVersion: 1,
    observe: async () => snapshot([node]),
    locate: async () => [node],
  });
  const config = resolveConfig(
    { targets: [{ name: 'fake', platform: 'custom', engine }], cache: 'off' },
    { projectRoot: process.cwd(), env: {} },
  );
  const signal = new AbortController().signal;
  const steps = new StepRecorder('attempt');
  const { fixtures } = createFixtures({
    config,
    target: config.targets[0]!,
    session: createEngineSession({ engine, targetName: 'fake' }),
    steps,
    budget: new AttemptBudget(signal, new Deadline(10_000)),
    runId: 'run',
    attemptId: 'attempt',
    attempt: { testId: 'test', attemptId: 'attempt', index: 0, signal, memory: new Map() },
    artifacts: { dir: '/tmp', register: () => 'artifact' },
    priorSteps: () => steps.completed(),
    agentContext: undefined,
    saveSession: undefined,
    models: new WorkerModels(() => {}),
  });
  return fixtures.screen;
}

describe('attribute and focus expectations', () => {
  it('does not mistake withheld input data for an empty value', async () => {
    const unavailable = createAttributeFixture({ ref: { id: 'node-1', revision: '' }, role: 'textbox' }).getByRole('textbox');
    await expect(unavailable.inputValue()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    const empty = createAttributeFixture({ ref: { id: 'node-1', revision: '' }, role: 'textbox', value: '' }).getByRole('textbox');
    await expect(empty.inputValue()).resolves.toBe('');
  });

  it.each(['toHaveText', 'toContainText', 'toHaveValue', 'toHaveAccessibleName'] as const)('%s requires reported data for positive and negated assertions', async (matcher) => {
    const unavailable = createAttributeFixture({ ref: { id: 'node-1', revision: '' }, role: 'textbox' }).getByRole('textbox');
    await expect(expectFixture(unavailable)[matcher]('', { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expect(expectFixture(unavailable)[matcher](/^$/, { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expect(expectFixture(unavailable).not[matcher]('present', { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    const empty = createAttributeFixture({ ref: { id: 'node-1', revision: '' }, role: 'textbox', value: '', text: '', name: '' }).getByRole('textbox');
    await expectFixture(empty)[matcher]('', { timeout: 0 });
    await expectFixture(empty).not[matcher]('present', { timeout: 0 });
  });

  it('preserves whitespace in input values and attributes for strings and regexps', async () => {
    const raw = ' a  b\n';
    const screen = createAttributeFixture({
      ref: { id: 'node-1', revision: '' },
      role: 'textbox',
      value: raw,
      text: raw,
      attributes: { 'data-value': raw, class: 'card  active' },
    });
    const locator = screen.getByRole('textbox');
    await expectFixture(locator).toHaveValue(raw);
    await expectFixture(locator).toHaveAttribute('data-value', raw);
    const pattern = /^ a  b\n$/g;
    await expectFixture(locator).toHaveValue(pattern);
    await expectFixture(locator).toHaveValue(pattern);
    await expectFixture(locator).toHaveAttribute('data-value', pattern);
    await expect(expectFixture(locator).toHaveValue('a b', { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expect(expectFixture(locator).toHaveAttribute('data-value', 'a b', { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expect(expectFixture(locator).toHaveAttribute('class', 'card active', { timeout: 0 })).rejects.toMatchObject({ code: 'ASSERTION_FAILED' });
    await expectFixture(locator).toHaveText('a b');
    await expectFixture(locator).toContainText('a b');
  });

  it('matches attribute presence and values without normalizing whitespace', async () => {
    const screen = createAttributeFixture({
      ref: { id: 'node-1', revision: '' },
      role: 'textbox',
      attributes: { readonly: '', class: 'card  active' },
      states: { focused: true },
    });
    const locator = screen.getByRole('textbox');

    await expectFixture(locator).toHaveAttribute('readonly');
    await expectFixture(locator).toHaveAttribute('readonly', '');
    await expectFixture(locator).toHaveAttribute('class', /active/);
    await expectFixture(locator).not.toHaveAttribute('hidden');
    await expectFixture(locator).toBeFocused();
  });
});
