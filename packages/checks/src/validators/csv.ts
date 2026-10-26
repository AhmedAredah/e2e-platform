import { OutputValidator } from './base.ts';
import { JsonValidator } from './json.ts';
import type { ComparisonResult, CsvComparisonOptions } from '../types.ts';
import { parseDecimal } from '../internal/decimal.ts';

/** Parses quoted CSV, preserving embedded newlines and rejecting malformed fields. */
export function parseCsv(text: string, delimiter = ','): readonly (readonly string[])[] {
  if (delimiter.length !== 1 || ['"', '\r', '\n'].includes(delimiter)) throw new TypeError('CSV delimiter must be one non-quote, non-newline character');
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (input.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let atStart = true;
  let endedLine = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    endedLine = false;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (char === delimiter) { row.push(field); field = ''; closed = false; atStart = true; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; closed = false; atStart = true; endedLine = true; continue;
    }
    if (closed) throw new SyntaxError(`Unexpected character after closing CSV quote at offset ${i}`);
    if (char === '"') {
      if (!atStart) throw new SyntaxError(`Quote in unquoted CSV field at offset ${i}`);
      quoted = true; atStart = false;
    } else { field += char; atStart = false; }
  }
  if (quoted) throw new SyntaxError('Unterminated quoted CSV field');
  if (!endedLine) { row.push(field); rows.push(row); }
  return rows;
}

function csvRecords(text: string, options: CsvComparisonOptions): { headers: string[]; rows: Record<string, unknown>[] } {
  const parsed = parseCsv(text, options.delimiter);
  const headers = [...(parsed[0] ?? [])];
  if (headers.length === 0 || headers.some(h => h === '') || new Set(headers).size !== headers.length) throw new SyntaxError('CSV requires unique, non-empty column names');
  const ignored = new Set(options.ignoreColumns ?? []);
  const rows: Record<string, unknown>[] = [];
  for (const fields of parsed.slice(1)) {
    if (fields.length !== headers.length) throw new SyntaxError(`CSV row has ${fields.length} fields; expected ${headers.length}`);
    const record: Record<string, unknown> = Object.create(null);
    headers.forEach((name, i) => {
      if (ignored.has(name)) return;
      const value = fields[i]!;
      const numeric = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Infinity)$/.test(value) || value === 'NaN';
      if (options.numbers !== undefined && numeric && !(options.keyColumns ?? []).includes(name)) {
        record[name] = ['NaN', 'Infinity', '+Infinity', '-Infinity'].includes(value) ? Number(value) : parseDecimal(value, options.numbers.unsafeIntegers);
      } else record[name] = value;
    });
    rows.push(record);
  }
  return { headers, rows };
}


/** Tabular oracle sharing structural and numeric semantics with the JSON validator. */
export class CsvValidator extends OutputValidator<string, CsvComparisonOptions> {
  constructor(protected readonly json: JsonValidator = new JsonValidator()) { super(); }
/** Compares CSV records, optionally aligning uniquely keyed rows before value checks. */
  compare(actualText: string, expectedText: string, options: CsvComparisonOptions = {}): ComparisonResult {
    const actual = csvRecords(actualText, options);
    const expected = csvRecords(expectedText, options);
    const ignore = new Set(options.ignoreColumns ?? []);
    for (const key of options.keyColumns ?? []) {
      if (ignore.has(key) || !actual.headers.includes(key) || !expected.headers.includes(key)) throw new TypeError(`Invalid or missing CSV key column: ${key}`);
    }
    if (new Set(options.keyColumns).size !== (options.keyColumns?.length ?? 0)) throw new TypeError('CSV key columns must be unique');
    for (const name of ignore) if (!actual.headers.includes(name) && !expected.headers.includes(name)) throw new TypeError(`Ignored CSV column does not exist: ${name}`);
    const headers = this.json.compare(actual.headers.filter(x => !ignore.has(x)).toSorted(), expected.headers.filter(x => !ignore.has(x)).toSorted(), options);
    if (!headers.matches) return { ...headers, differences: headers.differences.map(d => ({ ...d, path: `/headers${d.path}` })) };
    if ((options.keyColumns?.length ?? 0) === 0) return this.json.compare(actual.rows, expected.rows, options);
    const keyed = (rows: Record<string, unknown>[]): Record<string, unknown> => {
      const result: Record<string, unknown> = Object.create(null);
      for (const row of rows) {
        const key = JSON.stringify(options.keyColumns!.map(k => row[k]));
        if (Object.hasOwn(result, key)) throw new TypeError(`Duplicate CSV row key: ${key}`);
        result[key] = row;
      }
      return result;
    };
    return this.json.compare(keyed(actual.rows), keyed(expected.rows), options);
  }


}
