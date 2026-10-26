import { NumericValidator } from './validators/numeric.ts';
import { JsonValidator } from './validators/json.ts';
import { CsvValidator } from './validators/csv.ts';
import type { NumericTolerance, NumericComparison, ComparisonResult, JsonComparisonOptions, CsvComparisonOptions } from './types.ts';

export type { NumericTolerance, NumericComparison, Difference, ComparisonResult, ComparisonOptions, JsonComparisonOptions, CsvComparisonOptions, JsonReadOptions } from './types.ts';
export { OutputValidator, assertComparison } from './validators/base.ts';
export { NumericValidator } from './validators/numeric.ts';
export { JsonValidator } from './validators/json.ts';
export { CsvValidator, parseCsv } from './validators/csv.ts';
export { readJsonFile } from './io/json-file.ts';

const numeric = new NumericValidator();
const json = new JsonValidator(numeric);
const csv = new CsvValidator(json);

/** Compares numbers with the default numerical validator. */
export function compareNumbers(actual: number, expected: number, options?: NumericTolerance): NumericComparison { return numeric.evaluate(actual, expected, options); }
/** Compares JSON output with the default structural validator. */
export function compareJson(actual: unknown, expected: unknown, options?: JsonComparisonOptions): ComparisonResult { return json.compare(actual, expected, options); }
/** Compares CSV output with the default tabular validator. */
export function compareCsv(actual: string, expected: string, options?: CsvComparisonOptions): ComparisonResult { return csv.compare(actual, expected, options); }
