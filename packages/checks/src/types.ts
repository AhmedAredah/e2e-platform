/** An explicit error budget for finite values; zero tolerance is exact. */
export interface NumericTolerance {
  readonly absolute?: number;
  readonly relative?: number;
  readonly nan?: 'equal' | 'reject';
  readonly infinity?: 'equal' | 'reject';
  /** Opt in only when comparing large integral binary64 values is intentional. */
  readonly unsafeIntegers?: 'allow' | 'reject';
}

/** Evidence for one numerical comparison. */
export interface NumericComparison {
  readonly matches: boolean;
  readonly difference: number;
  readonly allowedDifference: number;
  readonly reason?: string;
}

/** One independently observed mismatch, addressed by a JSON pointer. */
export interface Difference {
  readonly path: string;
  readonly actual: unknown;
  readonly expected: unknown;
  readonly message: string;
}

/** A bounded report; truncated reports always represent failure. */
export interface ComparisonResult {
  readonly matches: boolean;
  readonly differences: readonly Difference[];
  readonly truncated: boolean;
}

/** Configuration shared by structural and tabular checks. */
export interface ComparisonOptions {
  readonly numbers?: NumericTolerance;
  readonly maxDifferences?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

/** Exact JSON pointers excluded deliberately from a structural comparison. */
export interface JsonComparisonOptions extends ComparisonOptions {
  readonly ignorePaths?: readonly string[];
}

/** CSV rows may be aligned by unique keys; header ordering is immaterial. */
export interface CsvComparisonOptions extends ComparisonOptions {
  readonly keyColumns?: readonly string[];
  readonly ignoreColumns?: readonly string[];
  readonly delimiter?: string;
}

/** JSON parsing is loss-checked by default; C++ binary64 serialization can opt into rounding. */
export interface JsonReadOptions {
  /** exact rejects changed decimal values; binary64 accepts finite rounding from e.g. max_digits10. */
  readonly decimalPrecision?: 'exact' | 'binary64';
  readonly unsafeIntegers?: 'allow' | 'reject';
}
