# @e2e-platform/checks

Deterministic assertions on actual native-application output. No AI or network calls.

```ts
import { assertComparison, compareCsv, compareJson, compareNumbers, readJsonFile } from '@e2e-platform/checks';

assertComparison(compareJson(await readJsonFile('result.json'), { total: 10 }, {
  numbers: { absolute: 0.00001, relative: 0.000001 },
}));
assertComparison(compareCsv(actualCsv, expectedCsv, { keyColumns: ['id'], numbers: { absolute: 0.01 } }));
if (!compareNumbers(actual, expected, { relative: 0.001 }).matches) throw new Error('Calculation differs');
```

Numbers compare exactly unless an error budget is explicit. The symmetric predicate is
`abs(actual - expected) <= max(absolute, relative * max(abs(actual), abs(expected)))`,
evaluated using normalized relative error to avoid false passes from overflow or a rounded-up
subnormal error budget. The absolute and relative predicates are checked independently;
the returned `allowedDifference` remains a binary64 diagnostic and may round at the limits
of that format. NaN and infinity are rejected
unless their separate policy explicitly permits equal values. Tolerances never change automatically.

JSON object key order is immaterial; arrays are ordered. `ignorePaths` uses exact JSON pointers
(for example `/metadata/time`, with `~1` for a slash). Depth, pending nodes and mismatch reports
are bounded, and reaching a traversal limit fails. Inputs should be JSON data, not live class instances.

JavaScript numbers are binary64. Unsafe integers fail by default: serialize C++ `int64_t`/`uint64_t`
identifiers and high-precision results as strings for exact comparisons. `unsafeIntegers: 'allow'`
is an explicit opt-in for intentional large integral binary64 calculations. `readJsonFile` and numeric
CSV conversion reject decimal literals that cannot round-trip without changing their spelling's
numeric meaning, including overflow, underflow and rounded adjacent 64-bit integers. The JSON
reader accepts the same unsafe-integer option as its third argument. For known C++
`max_digits10` output, explicitly use `readJsonFile(path, limit, { decimalPrecision: 'binary64' })`.
This permits finite rounding, including underflow, and keeps the unsafe-integer guard.
Use the default `decimalPrecision: 'exact'` when any decimal change must fail. Numeric literals are limited
to 4096 characters. These helpers do not claim arbitrary-precision arithmetic.

CSV supports BOM, CRLF, quoted delimiters/newlines and escaped quotes. Headers are unique and
non-empty. Rows compare in order unless unique `keyColumns` align them. Numeric conversion
requires `numbers` to be supplied and never changes key fields. Blank strings are not zero.
`ignoreColumns` is explicit; a misspelled missing column fails. Parsing operates on the supplied
string in memory; bound file size before loading large datasets. This is not a streaming database diff.

These comparisons verify outputs; use domain-specific units, invariants and independently reviewed
expected values. A passing GUI status alone cannot certify a computation.

## Class hierarchy and extension

`OutputValidator<T, Options>` supplies the shared assertion contract. `NumericValidator`,
`JsonValidator`, and `CsvValidator` inherit it. A JSON validator accepts a numerical validator;
a CSV validator accepts a JSON validator. Override only the policy that varies and reuse the
remaining traversal, evidence limits and diagnostics:

```ts
import { OutputValidator, NumericValidator, JsonValidator } from '@e2e-platform/checks';
import type { ComparisonResult } from '@e2e-platform/checks';

class MassBalanceValidator extends OutputValidator<{ incoming: number; outgoing: number }> {
  private readonly numbers = new NumericValidator();
  compare(actual: { incoming: number; outgoing: number }, expected: { incoming: number; outgoing: number }): ComparisonResult {
    return this.numbers.compare(actual.incoming - actual.outgoing, expected.incoming - expected.outgoing, { absolute: 0.00001 });
  }
}
```

The public `index.ts` is a facade. Implementations are split into `validators/`, shared
`types.ts`, bounded file readers in `io/`, and private mechanics in `internal/`.
