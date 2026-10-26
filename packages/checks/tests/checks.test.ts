import { describe, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertComparison, compareCsv, compareJson, compareNumbers, parseCsv, readJsonFile, OutputValidator, NumericValidator, JsonValidator, CsvValidator } from '../src/index.ts';
import type { NumericComparison, NumericTolerance, ComparisonResult } from '../src/index.ts';

describe('numerical error budgets', () => {
  test('is exact by default and symmetric with explicit tolerances', () => {
    expect(compareNumbers(1, 1 + Number.EPSILON).matches).toBe(false);
    expect(compareNumbers(0.001, 0, { absolute: 0.002 }).matches).toBe(true);
    expect(compareNumbers(100, 101, { relative: 0.01 }).matches).toBe(true);
    expect(compareNumbers(101, 100, { relative: 0.01 }).matches).toBe(true);
    expect(compareNumbers(0, 1, { relative: 0.01 }).matches).toBe(false);
  });
  test('does not mistake arithmetic overflow for passing evidence', () => {
    expect(compareNumbers(1e308, -1e308, { relative: 1.5, unsafeIntegers: 'allow' }).matches).toBe(false);
    expect(compareNumbers(1e308, -1e308, { relative: 2, unsafeIntegers: 'allow' }).matches).toBe(true);
  });
  test('does not round a subnormal relative budget into a false pass', () => {
    for (const sign of [-1, 1]) {
      const actual = sign * 2 * Number.MIN_VALUE;
      const expected = sign * Number.MIN_VALUE;
      expect(compareNumbers(actual, expected, { relative: 0.4 })).toMatchObject({ matches: false, reason: expect.stringContaining('Relative difference 0.5') });
      expect(compareNumbers(expected, actual, { relative: 0.4 }).matches).toBe(false);
      expect(compareNumbers(actual, expected, { relative: 0.5 }).matches).toBe(true);
      expect(compareNumbers(actual, expected, { relative: 0.4, absolute: Number.MIN_VALUE }).matches).toBe(true);
      expect(compareNumbers(actual, expected).matches).toBe(false);
    }
    expect(compareNumbers(Number.MIN_VALUE, 0, { relative: 0.9 }).matches).toBe(false);
    expect(compareNumbers(Number.MIN_VALUE, 0, { relative: 1 }).matches).toBe(true);
    expect(compareNumbers(Number.MIN_VALUE, -Number.MIN_VALUE, { relative: 1.5 }).matches).toBe(false);
    expect(compareNumbers(Number.MIN_VALUE, -Number.MIN_VALUE, { relative: 2 }).matches).toBe(true);
    expect(compareNumbers(0, -0).matches).toBe(true);
  });
  test('keeps relative accuracy at the normal/subnormal boundary and finite extremes', () => {
    const normal = 2 ** -1022;
    const adjacent = normal - Number.MIN_VALUE;
    expect(compareNumbers(normal, adjacent, { relative: Number.EPSILON / 2 }).matches).toBe(false);
    expect(compareNumbers(normal, adjacent, { relative: Number.EPSILON }).matches).toBe(true);
    expect(compareNumbers(Number.MAX_VALUE, -Number.MAX_VALUE, { absolute: Number.MAX_VALUE, relative: 1.99, unsafeIntegers: 'allow' }).matches).toBe(false);
    expect(compareNumbers(Number.MAX_VALUE, -Number.MAX_VALUE, { relative: 2, unsafeIntegers: 'allow' }).matches).toBe(true);
    expect(compareNumbers(Number.MAX_VALUE, Number.MAX_VALUE / 2, { relative: 0.5, unsafeIntegers: 'allow' }).matches).toBe(true);
    expect(compareNumbers(Number.MAX_VALUE, Number.MAX_VALUE / 2, { relative: 0.49, unsafeIntegers: 'allow' }).matches).toBe(false);
  });
  test('uses the same stable relative predicate for JSON and numeric CSV', () => {
    const numbers = { relative: 0.4 };
    expect(compareJson({ value: 2 * Number.MIN_VALUE }, { value: Number.MIN_VALUE }, { numbers }).matches).toBe(false);
    expect(compareCsv('value\n1e-323', 'value\n5e-324', { numbers }).matches).toBe(false);
    expect(compareCsv('value\n1e-323', 'value\n5e-324', { numbers: { relative: 0.5 } }).matches).toBe(true);
  });
  test('requires explicit nonfinite policies', () => {
    expect(compareNumbers(NaN, NaN).matches).toBe(false);
    expect(compareNumbers(NaN, NaN, { nan: 'equal' }).matches).toBe(true);
    expect(compareNumbers(Infinity, Infinity).matches).toBe(false);
    expect(compareNumbers(Infinity, Infinity, { infinity: 'equal' }).matches).toBe(true);
    expect(compareNumbers(-Infinity, Infinity, { infinity: 'equal' }).matches).toBe(false);
    expect(() => compareNumbers(1, 1, { relative: -1 })).toThrow();
  });
});

test('fails closed on lossy C++ integer and extended precision conversions', async () => {
  for (const [actual, expected] of [['9007199254740992', '9007199254740993'], ['1e-999', '2e-999'], ['1e999', '2e999'], ['1.0000000000000000001', '1.0000000000000000002']]) {
    expect(() => compareCsv(`value\n${actual}`, `value\n${expected}`, { numbers: { infinity: 'equal' } })).toThrow();
  }
  expect(compareCsv('id\n9007199254740992', 'id\n9007199254740993').matches).toBe(false);
  expect(compareNumbers(Number('9007199254740992'), Number('9007199254740993')).matches).toBe(false);
  expect(() => assertComparison({ matches: true, truncated: true, differences: [] })).toThrow();
  expect(compareJson({}, { a: 1, b: 2 }, { maxDifferences: 2 }).truncated).toBe(false);
  const dir = await mkdtemp(join(tmpdir(), 'e2e-precision-'));
  try {
    const file = join(dir, 'output.json');
    for (const token of ['9007199254740993', '1e-999', '1e999', '1.0000000000000000001']) {
      await writeFile(file, `{"result":${token}}`);
      await expect(readJsonFile(file)).rejects.toThrow();
    }
    await writeFile(file, '{"result":"9007199254740993","note":"1e999"}');
    expect(await readJsonFile(file)).toEqual({ result: '9007199254740993', note: '1e999' });
    await writeFile(file, '{"result":1e308}');
    expect(await readJsonFile(file, 1024, { unsafeIntegers: 'allow' })).toEqual({ result: 1e308 });
    await writeFile(file, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
    await expect(readJsonFile(file)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('validates options without invoking subclass evaluation on synthetic zero', () => {
  class PositiveValidator extends NumericValidator {
    override evaluate(actual: number, expected: number, options?: NumericTolerance): NumericComparison {
      if (actual <= 0 || expected <= 0) throw new RangeError('positive values only');
      return super.evaluate(actual, expected, options);
    }
  }
  expect(new JsonValidator(new PositiveValidator()).compare({ x: 1 }, { x: 1 }, { numbers: {} }).matches).toBe(true);
});

describe('independent structured comparisons', () => {
  test('ignores field order but preserves arrays, missing fields, types and pointer escaping', () => {
    expect(compareJson({ a: 1, b: [2] }, { b: [2], a: 1 }).matches).toBe(true);
    const changed = compareJson({ 'a/b': 1, b: [2, 3] }, { 'a/b': '1', b: [3, 2] });
    expect(changed.matches).toBe(false);
    expect(changed.differences.some(d => d.path === '/a~1b')).toBe(true);
    expect(compareJson({ a: undefined }, {}).matches).toBe(false);
  });
  test('supports explicit exclusion and numeric tolerance without hiding new fields', () => {
    expect(compareJson({ time: 2, value: 1.0001 }, { time: 1, value: 1 }, { ignorePaths: ['/time'], numbers: { absolute: 0.001 } }).matches).toBe(true);
    expect(compareJson({ value: 1, surprise: true }, { value: 1 }).matches).toBe(false);
    expect(compareJson(new Date(), new Date()).matches).toBe(false);
  });
  test('bounds evidence and rejects cycles/depth exhaustion as failure', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(compareJson(cycle, cycle, { maxDepth: 5 }).matches).toBe(false);
    const result = compareJson([1, 2, 3], [2, 3, 4], { maxDifferences: 1 });
    expect(result.differences).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(() => assertComparison(result)).toThrow('Output comparison failed');
  });
});

describe('CSV results', () => {
  test('parses quotes, commas, CRLF and embedded newlines', () => {
    expect(parseCsv('\uFEFFid,note\r\n1,"hello, ""world""\nnext"\r\n')).toEqual([['id', 'note'], ['1', 'hello, "world"\nnext']]);
    expect(() => parseCsv('a\n"unterminated')).toThrow();
    expect(() => parseCsv('a\n"quoted"x')).toThrow();
  });
  test('aligns rows by unique keys and columns by name; numbers require explicit policy', () => {
    const a = 'id,value\nb,10.01\na,2\n';
    const b = 'value,id\n2,a\n10,b\n';
    expect(compareCsv(a, b, { keyColumns: ['id'], numbers: { absolute: 0.02 } }).matches).toBe(true);
    expect(compareCsv(a, b, { keyColumns: ['id'] }).matches).toBe(false);
    expect(() => compareCsv('id,x\na,1\na,2', 'id,x\na,1', { keyColumns: ['id'] })).toThrow('Duplicate');
  });
  test('rejects malformed tables, missing keys and accidental ignore names', () => {
    expect(() => compareCsv('id,id\n1,2', 'id,x\n1,2')).toThrow();
    expect(() => compareCsv('id,x\n1', 'id,x\n1,2')).toThrow();
    expect(() => compareCsv('id\n1', 'id\n1', { keyColumns: ['missing'] })).toThrow();
    expect(() => compareCsv('id\n1', 'id\n1', { ignoreColumns: ['typo'] })).toThrow();
    expect(compareCsv('id,x\n1,NaN', 'id,x\n1,NaN', { numbers: {} }).matches).toBe(false);
  });
});

test('reads real output files with bounded size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-checks-'));
  try {
    const file = join(dir, 'result.json');
    await writeFile(file, '{"answer":42}');
    expect(await readJsonFile(file)).toEqual({ answer: 42 });
    await expect(readJsonFile(file, 2)).rejects.toThrow('exceeds');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('supports inherited domain validators and injected numerical policies', () => {
  class DecimalValidator extends NumericValidator {
    override evaluate(actual: number, expected: number, tolerance?: NumericTolerance): NumericComparison {
      return super.evaluate(Math.round(actual * 100) / 100, Math.round(expected * 100) / 100, tolerance);
    }
  }
  const json = new JsonValidator(new DecimalValidator());
  expect(json.compare({ value: 1.001 }, { value: 1.002 }).matches).toBe(true);
  const csv = new CsvValidator(json);
  expect(csv.compare('x\n1.001', 'x\n1.002', { numbers: {} }).matches).toBe(true);
  class MassBalanceValidator extends OutputValidator<{ incoming: number; outgoing: number }> {
    compare(actual: { incoming: number; outgoing: number }, expected: { incoming: number; outgoing: number }): ComparisonResult {
      return new NumericValidator().compare(actual.incoming - actual.outgoing, expected.incoming - expected.outgoing);
    }
  }
  const validator = new MassBalanceValidator();
  expect(() => validator.assert({ incoming: 5, outgoing: 4 }, { incoming: 5, outgoing: 5 })).toThrow('Output comparison failed');
});

test('supports explicit C++ max_digits10 rounding without weakening the strict default or integer guard', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-binary64-'));
  const file = join(directory, 'result.json');
  try {
    await writeFile(file, '{"value":0.10000000000000001}');
    await expect(readJsonFile(file)).rejects.toThrow('round-trip');
    expect(await readJsonFile(file, 1024, { decimalPrecision: 'binary64' })).toEqual({ value: 0.1 });
    for (const value of ['9007199254740993', '1e999']) {
      await writeFile(file, `{"value":${value}}`);
      await expect(readJsonFile(file, 1024, { decimalPrecision: 'binary64' })).rejects.toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
