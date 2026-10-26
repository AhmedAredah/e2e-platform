import { OutputValidator } from './base.ts';
import { NumericValidator } from './numeric.ts';
import { positiveInteger, pointer, isPlainObject, jsonKind } from '../internal/options.ts';
import type { ComparisonResult, Difference, JsonComparisonOptions } from '../types.ts';

/** Structural oracle; inject a numeric subclass for domain-specific number semantics. */
export class JsonValidator extends OutputValidator<unknown, JsonComparisonOptions> {
  constructor(protected readonly numeric: NumericValidator = new NumericValidator()) { super(); }
/** Compares JSON values iteratively, with bounded traversal and mismatch evidence. */
  compare(actual: unknown, expected: unknown, options: JsonComparisonOptions = {}): ComparisonResult {
    const maxDifferences = positiveInteger(options.maxDifferences, 100, 'maxDifferences');
    const maxNodes = positiveInteger(options.maxNodes, 100_000, 'maxNodes');
    const maxDepth = positiveInteger(options.maxDepth, 100, 'maxDepth');
    if (options.numbers !== undefined) this.numeric.validateOptions(options.numbers);
    const ignored = new Set(options.ignorePaths ?? []);
    for (const path of ignored) if (path !== '' && !path.startsWith('/')) throw new TypeError('ignorePaths must be JSON pointers');
    const differences: Difference[] = [];
    const queue: { actual: unknown; expected: unknown; path: string; depth: number }[] = [{ actual, expected, path: '', depth: 0 }];
    let visited = 0;
    let truncated = false;
    while (queue.length > 0) {
      const item = queue.pop()!;
      if (ignored.has(item.path)) continue;
      if (++visited > maxNodes || item.depth > maxDepth) {
        differences.push({ path: item.path, actual: undefined, expected: undefined, message: 'Comparison traversal limit exceeded' });
        truncated = true;
        break;
      }
      const ak = jsonKind(item.actual);
      const ek = jsonKind(item.expected);
      let message: string | undefined;
      if (ak !== ek) message = `Type differs (${ak} versus ${ek})`;
      else if (ak === 'number') {
        const result = this.numeric.evaluate(Number(item.actual), Number(item.expected), options.numbers);
        if (!result.matches) message = result.reason ?? `Numeric difference ${result.difference} exceeds ${result.allowedDifference}`;
      } else if (ak === 'array' && Array.isArray(item.actual) && Array.isArray(item.expected)) {
        if (item.actual.length > maxNodes - visited) { message = 'Comparison node limit exceeded'; truncated = true; }
        else if (item.actual.length !== item.expected.length) message = 'Array length differs';
        else {
          for (let i = item.actual.length - 1; i >= 0; i--) {
            queue.push({ actual: item.actual[i], expected: item.expected[i], path: `${item.path}/${i}`, depth: item.depth + 1 });
          }
        }
      } else if (ak === 'object' && isPlainObject(item.actual) && isPlainObject(item.expected)) {
        const actualKeys = Object.keys(item.actual);
        const expectedKeys = Object.keys(item.expected);
        if (actualKeys.length > maxNodes - visited || expectedKeys.length > maxNodes - visited) {
          differences.push({ path: item.path, actual: undefined, expected: undefined, message: 'Comparison node limit exceeded' });
          truncated = true; break;
        }
        const keys = [...new Set([...actualKeys, ...expectedKeys])].toSorted().toReversed();
        for (const [keyIndex, key] of keys.entries()) {
          const path = `${item.path}/${pointer(key)}`;
          if (ignored.has(path)) continue;
          if (!Object.hasOwn(item.actual, key) || !Object.hasOwn(item.expected, key)) {
            differences.push({ path, actual: item.actual[key], expected: item.expected[key], message: 'Object field missing or unexpected' });
          } else queue.push({ actual: item.actual[key], expected: item.expected[key], path, depth: item.depth + 1 });
          if (differences.length >= maxDifferences) { truncated = queue.length > 0 || keyIndex < keys.length - 1; break; }
        }
      } else if (!['string', 'boolean', 'null'].includes(ak)) message = `Unsupported JSON value (${ak})`;
      else if (item.actual !== item.expected) message = 'Value differs';
      if (message !== undefined) differences.push({ path: item.path, actual: item.actual, expected: item.expected, message });
      if (differences.length >= maxDifferences) { truncated ||= queue.length > 0; break; }
      if (queue.length > maxNodes) {
        differences.push({ path: item.path, actual: undefined, expected: undefined, message: 'Comparison pending-node limit exceeded' });
        truncated = true;
        break;
      }
    }
    return { matches: differences.length === 0, differences: differences.slice(0, maxDifferences), truncated };
  }


}
