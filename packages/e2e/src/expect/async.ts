/** Runner-owned polling locator assertions. */

import type { SemanticNode } from '../engine/surface.ts';
import { asEngineError, isForeignE2EError, TestError } from '../internal/errors.ts';
import { normalizeText, containsText, matchesText, toTextPattern, describePattern } from '../internal/text.ts';
import { testPattern } from '../internal/regexp.ts';
import { Deadline, pollCondition } from '../internal/time.ts';
import { isNodeVisible } from '../locator/engine.ts';
import { describeExpression } from '../locator/expression.ts';
import type { LocatorInternals } from '../locator/screen.ts';
import type { AsyncExpectation, TextMatch } from '../types.ts';

interface Sample {
  readonly count: number;
  readonly node: SemanticNode | null;
}

interface MatcherSpec {
  readonly name: string;
  /** Evaluates the whole sample instead of requiring one node. */
  readonly wholeSet?: boolean;
  /** The predicate is meaningful even when zero nodes match. */
  readonly evaluableWithoutNode?: boolean;
  /** A withheld text field is unknown, even when the matcher is negated. */
  readonly requiredField?: 'text' | 'value' | 'name';
  /** Unknown visibility must not satisfy positive or negated assertions. */
  readonly requiresVisibility?: boolean;
  readonly requiredKnownState?: 'enabledKnown' | 'focusedKnown';
  readonly predicate: (sample: Sample) => boolean;
  readonly describeExpected: string;
  readonly observed: (sample: Sample) => string;
}

type StateKey = 'disabled' | 'checked' | 'selected' | 'expanded' | 'focused';

interface StateMatcherDef {
  readonly key: StateKey;
  readonly expected: boolean;
  readonly describeExpected: string;
}

const STATE_MATCHERS = {
  toBeEnabled: { key: 'disabled', expected: false, describeExpected: 'enabled' },
  toBeDisabled: { key: 'disabled', expected: true, describeExpected: 'disabled' },
  toBeChecked: { key: 'checked', expected: true, describeExpected: 'checked' },
  toBeSelected: { key: 'selected', expected: true, describeExpected: 'selected' },
  toBeExpanded: { key: 'expanded', expected: true, describeExpected: 'expanded' },
  toBeFocused: { key: 'focused', expected: true, describeExpected: 'focused' },
} as const satisfies Record<string, StateMatcherDef>;

interface TextMatcherDef {
  readonly field: 'text' | 'value' | 'name';
  readonly match: (actual: string, pattern: ReturnType<typeof toTextPattern>) => boolean;
  readonly describeExpected: (pattern: string) => string;
  readonly normalize: boolean;
}

const TEXT_MATCHERS = {
  toHaveText: {
    field: 'text',
    match: matchesText,
    describeExpected: (pattern) => `text ${pattern}`,
    normalize: true,
  },
  toContainText: {
    field: 'text',
    match: containsText,
    describeExpected: (pattern) => `text containing ${pattern}`,
    normalize: true,
  },
  toHaveValue: {
    field: 'value',
    match: matchesRawValue,
    describeExpected: (pattern) => `value ${pattern}`,
    normalize: false,
  },
  toHaveAccessibleName: {
    field: 'name',
    match: matchesText,
    describeExpected: (pattern) => `accessible name ${pattern}`,
    normalize: false,
  },
} as const satisfies Record<string, TextMatcherDef>;

/** Matches raw values exactly, preserving whitespace in strings and regexp input. */
function matchesRawValue(actual: string, pattern: ReturnType<typeof toTextPattern>): boolean {
  return pattern.kind === 'string'
    ? actual === pattern.value
    : testPattern(pattern.source, pattern.flags, actual);
}

class AsyncExpectationImpl implements AsyncExpectation {
  constructor(
    private readonly internals: LocatorInternals,
    private readonly negated: boolean,
    private readonly message: string | undefined,
  ) {}

  get not(): AsyncExpectation {
    return new AsyncExpectationImpl(this.internals, !this.negated, this.message);
  }

  private get label(): string {
    return describeExpression(this.internals.expression);
  }

  private async poll(spec: MatcherSpec, timeout: number | undefined): Promise<void> {
    const { engine } = this.internals.context;
    const api = `expect.${this.negated ? 'not.' : ''}${spec.name}`;
    await this.internals.context.steps.run('assertion', api, this.label, async () => {
      const deadline = engine.deadline(timeout ?? engine.assertionTimeout);
      let lastSample: Sample = { count: 0, node: null };
      let sampled = false;
      await pollCondition({
        deadline,
        signal: engine.signal,
        negated: this.negated,
        evaluate: async () => {
          let sample: Sample;
          try { sample = await this.sample(spec, deadline); }
          catch (error) {
            // A final read can consume the remaining assertion budget. Preserve
            // the last observation as a failed assertion, never a negated pass.
            if (sampled && deadline.expired() && !engine.signal.aborted && isForeignE2EError(error)
              && error.category === 'test' && error.code === 'ACTION_FAILED' && asEngineError(error.cause)?.code === 'OPERATION_TIMEOUT') return undefined;
            throw error;
          }
          lastSample = sample;
          sampled = true;
          if (!this.conditionEvaluable(spec, sample)) return undefined;
          return spec.predicate(sample);
        },
        onTimeout: () => {
          const expected = `${this.negated ? 'not ' : ''}${spec.describeExpected}`;
          const observed = spec.observed(lastSample);
          return new TestError(
            'ASSERTION_FAILED',
            [
              ...(this.message === undefined ? [] : [this.message]),
              `${api} failed`,
              `locator: ${this.label}`,
              `expected: ${expected}`,
              `observed: ${observed} (match count ${lastSample.count})`,
            ].join('\n'),
            {
              // The same facts, one per field, for a reporter that lays them out.
              details: { locator: this.label, expected, observed, matches: lastSample.count },
            },
          );
        },
      });
    }, { verifies: true });
  }

  /**
   * Single-node matchers require an unambiguous node before their predicate
   * means anything; visibility matchers also accept zero matches.
   */
  private conditionEvaluable(spec: MatcherSpec, sample: Sample): boolean {
    if (spec.requiresVisibility === true && sample.node?.states?.visibilityKnown === false) return false;
    if (spec.requiredKnownState !== undefined && sample.node?.states?.[spec.requiredKnownState] === false) return false;
    if (spec.requiredField !== undefined && sample.node?.[spec.requiredField] === undefined) return false;
    return spec.wholeSet === true || sample.node !== null || spec.evaluableWithoutNode === true;
  }

  private async sample(spec: MatcherSpec, deadline: Deadline): Promise<Sample> {
    const { engine } = this.internals.context;
    if (spec.wholeSet === true) {
      const refs = await engine.resolveAll(this.internals.expression, deadline);
      return { count: refs.length, node: null };
    }
    const { node, count } = await engine.tryRead(this.internals.expression, deadline);
    return { count, node };
  }

  private stateMatcher(name: keyof typeof STATE_MATCHERS, timeout: number | undefined): Promise<void> {
    const def = STATE_MATCHERS[name];
    const requiredKnownState = def.key === 'disabled' ? 'enabledKnown' : def.key === 'focused' ? 'focusedKnown' : undefined;
    return this.poll(
      {
        name,
        ...(requiredKnownState === undefined ? {} : { requiredKnownState }),
        predicate: (sample) =>
          sample.node !== null && (sample.node.states?.[def.key] === true) === def.expected,
        describeExpected: def.describeExpected,
        observed: (sample) => requiredKnownState !== undefined && sample.node?.states?.[requiredKnownState] === false
          ? `${def.key === 'disabled' ? 'enabled' : 'focused'} state unavailable` : observedState(sample),
      },
      timeout,
    );
  }

  private textMatcher(
    name: keyof typeof TEXT_MATCHERS,
    expected: TextMatch,
    timeout: number | undefined,
  ): Promise<void> {
    const def = TEXT_MATCHERS[name];
    const pattern = toTextPattern(expected, { exact: true });
    return this.poll(
      {
        name,
        requiredField: def.field,
        predicate: (sample) => {
          const actual = sample.node?.[def.field];
          return actual !== undefined && def.match(actual, pattern);
        },
        describeExpected: def.describeExpected(describePattern(pattern)),
        observed: (sample) => {
          if (sample.node === null) return 'no node';
          const raw = sample.node[def.field];
          if (raw === undefined) return `${def.field} unavailable`;
          return `${def.field} ${JSON.stringify(def.normalize ? normalizeText(raw) : raw)}`;
        },
      },
      timeout,
    );
  }

  toBeVisible(options?: { timeout?: number }): Promise<void> {
    return this.poll(
      {
        name: 'toBeVisible',
        requiresVisibility: true,
        evaluableWithoutNode: true,
        predicate: (sample) => isNodeVisible(sample.node),
        describeExpected: 'visible',
        observed: observedState,
      },
      options?.timeout,
    );
  }

  toBeHidden(options?: { timeout?: number }): Promise<void> {
    return this.poll(
      {
        name: 'toBeHidden',
        requiresVisibility: true,
        evaluableWithoutNode: true,
        predicate: (sample) => !isNodeVisible(sample.node),
        describeExpected: 'hidden or absent',
        observed: observedState,
      },
      options?.timeout,
    );
  }

  toBeEnabled(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeEnabled', options?.timeout);
  }

  toBeDisabled(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeDisabled', options?.timeout);
  }

  toBeChecked(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeChecked', options?.timeout);
  }

  toBeSelected(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeSelected', options?.timeout);
  }

  toBeExpanded(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeExpanded', options?.timeout);
  }

  toBeFocused(options?: { timeout?: number }): Promise<void> {
    return this.stateMatcher('toBeFocused', options?.timeout);
  }

  toHaveText(expected: TextMatch, options?: { timeout?: number }): Promise<void> {
    return this.textMatcher('toHaveText', expected, options?.timeout);
  }

  toContainText(expected: TextMatch, options?: { timeout?: number }): Promise<void> {
    return this.textMatcher('toContainText', expected, options?.timeout);
  }

  toHaveValue(expected: TextMatch, options?: { timeout?: number }): Promise<void> {
    return this.textMatcher('toHaveValue', expected, options?.timeout);
  }

  toHaveAttribute(
    name: string,
    valueOrOptions?: TextMatch | { timeout?: number },
    options?: { timeout?: number },
  ): Promise<void> {
    let value: TextMatch | undefined;
    let timeout: number | undefined;
    if (typeof valueOrOptions === 'string' || valueOrOptions instanceof RegExp) {
      value = valueOrOptions;
      timeout = options?.timeout;
    } else {
      timeout = valueOrOptions?.timeout;
    }
    const pattern = value === undefined ? undefined : toTextPattern(value, { exact: true });
    return this.poll(
      {
        name: 'toHaveAttribute',
        predicate: (sample) => {
          if (sample.node === null) return false;
          const attribute = sample.node.attributes?.[name];
          return attribute !== undefined && (pattern === undefined || matchesRawValue(attribute, pattern));
        },
        describeExpected:
          pattern === undefined
            ? `attribute "${name}"`
            : `attribute "${name}" ${describePattern(pattern)}`,
        observed: (sample) => {
          if (sample.node === null) return 'no node';
          const attribute = sample.node.attributes?.[name];
          return attribute === undefined
            ? `attribute "${name}" absent`
            : `attribute "${name}" ${JSON.stringify(attribute)}`;
        },
      },
      timeout,
    );
  }

  toHaveAccessibleName(expected: TextMatch, options?: { timeout?: number }): Promise<void> {
    return this.textMatcher('toHaveAccessibleName', expected, options?.timeout);
  }

  toHaveCount(expected: number, options?: { timeout?: number }): Promise<void> {
    return this.poll(
      {
        name: 'toHaveCount',
        wholeSet: true,
        predicate: (sample) => sample.count === expected,
        describeExpected: `count ${expected}`,
        observed: (sample) => `count ${sample.count}`,
      },
      options?.timeout,
    );
  }
}

function observedState(sample: Sample): string {
  if (sample.node === null) return 'no node';
  const states = sample.node.states ?? {};
  if (states.visibilityKnown === false) return 'visibility unavailable';
  const active = Object.entries(states)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  return active.length === 0 ? 'default states' : `states: ${active.join(', ')}`;
}

export function createAsyncExpectation(internals: LocatorInternals, message?: string): AsyncExpectation {
  return new AsyncExpectationImpl(internals, false, message);
}
