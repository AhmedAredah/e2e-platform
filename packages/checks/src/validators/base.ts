import type { ComparisonResult } from '../types.ts';

/** Base class for independent result oracles. Subclasses implement comparison only. */
export abstract class OutputValidator<T, Options = object> {
  abstract compare(actual: T, expected: T, options?: Options): ComparisonResult;

  /** Verifies fresh output and raises a bounded diagnostic when it differs. */
  assert(actual: T, expected: T, options?: Options): void {
    assertComparison(this.compare(actual, expected, options));
  }
}

/** Fails a test with bounded independent comparison evidence. */
export function assertComparison(result: ComparisonResult): void {
  if (result.matches && !result.truncated && result.differences.length === 0) return;
  const lines = result.differences.map(d => `${d.path || '/'}: ${d.message}`);
  throw new Error(`Output comparison failed${result.truncated ? ' (evidence truncated)' : ''}\n${lines.join('\n')}`);
}
