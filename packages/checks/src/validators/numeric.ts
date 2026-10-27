import { OutputValidator } from './base.ts';
import type { ComparisonResult, NumericComparison, NumericTolerance } from '../types.ts';
import { withinTolerance } from '../internal/binary64.ts';

/** Extensible numeric oracle with an explicit error budget and non-finite policies. */
export class NumericValidator extends OutputValidator<number, NumericTolerance> {
  /** Validates a policy without inventing a data point for domain subclasses. */
  validateOptions(tolerance: NumericTolerance = {}): void {
    const absolute = tolerance.absolute ?? 0;
    const relative = tolerance.relative ?? 0;
    if (!Number.isFinite(absolute) || absolute < 0 || !Number.isFinite(relative) || relative < 0) throw new RangeError('Numeric tolerances must be finite and non-negative');
    if (tolerance.nan !== undefined && tolerance.nan !== 'equal' && tolerance.nan !== 'reject') throw new TypeError('Invalid NaN policy');
    if (tolerance.infinity !== undefined && tolerance.infinity !== 'equal' && tolerance.infinity !== 'reject') throw new TypeError('Invalid infinity policy');
    if (tolerance.unsafeIntegers !== undefined && tolerance.unsafeIntegers !== 'allow' && tolerance.unsafeIntegers !== 'reject') throw new TypeError('Invalid unsafe-integer policy');
  }
/** Compares numbers using a symmetric absolute/relative error budget. */
  evaluate(actual: number, expected: number, tolerance: NumericTolerance = {}): NumericComparison {
    this.validateOptions(tolerance);
    if (typeof actual !== 'number' || typeof expected !== 'number') throw new TypeError('compareNumbers requires numbers');
    const absolute = tolerance.absolute ?? 0;
    const relative = tolerance.relative ?? 0;
    if (Number.isNaN(actual) || Number.isNaN(expected)) {
      const matches = tolerance.nan === 'equal' && Number.isNaN(actual) && Number.isNaN(expected);
      return { matches, difference: Number.NaN, allowedDifference: 0, reason: matches ? 'Both values are NaN under the explicit equal policy' : 'NaN is not accepted' };
    }
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
      const matches = tolerance.infinity === 'equal' && actual === expected;
      return { matches, difference: matches ? 0 : Number.POSITIVE_INFINITY, allowedDifference: 0, reason: matches ? 'Same infinity under the explicit equal policy' : 'Non-finite value is not accepted' };
    }
    if (tolerance.unsafeIntegers !== 'allow' && [actual, expected].some(value => Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return { matches: false, difference: Math.abs(actual - expected), allowedDifference: 0, reason: 'Unsafe integer: preserve C++ int64/uint64 values as strings, or explicitly allow binary64 integer semantics' };
    }
    const difference = Math.abs(actual - expected);
    const scale = Math.max(Math.abs(actual), Math.abs(expected));
    const relativeDifference = relative === 0 ? 0 : relative * scale;
    const allowedDifference = Math.max(absolute, relativeDifference);
    // Normalize the error, not the tolerance: multiplying a subnormal scale can
    // round the permitted error upward. Divide operands first only on overflow.
    const relativeError = scale === 0 ? 0 : Number.isFinite(difference) ? difference / scale : Math.abs(actual / scale - expected / scale);
    const matches = withinTolerance(actual, expected, absolute, relative);
    return { matches, difference, allowedDifference,
      ...(!matches && difference <= allowedDifference ? { reason: `Relative difference ${relativeError} exceeds ${relative}; absolute difference ${difference} exceeds ${absolute}` } : {}),
    };
  }


  /** Projects numeric evidence into the common validator contract. */
  compare(actual: number, expected: number, options: NumericTolerance = {}): ComparisonResult {
    const result = this.evaluate(actual, expected, options);
    return { matches: result.matches, truncated: false, differences: result.matches ? [] : [{ path: '', actual, expected, message: result.reason ?? `Numeric difference ${result.difference} exceeds ${result.allowedDifference}` }] };
  }
}
