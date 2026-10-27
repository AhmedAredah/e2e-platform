import { validateJsonNumbers } from '../internal/decimal.ts';
import type { JsonReadOptions } from '../types.ts';

/** Parses JSON only after checking number tokens for information loss. */
export function parseJson(text: string, options: JsonReadOptions = {}): unknown {
  if (options.decimalPrecision !== undefined && !['exact', 'binary64'].includes(options.decimalPrecision)) throw new TypeError('decimalPrecision must be exact or binary64');
  if (options.unsafeIntegers !== undefined && !['allow', 'reject'].includes(options.unsafeIntegers)) throw new TypeError('unsafeIntegers must be allow or reject');
  validateJsonNumbers(text, options.unsafeIntegers, options.decimalPrecision);
  return JSON.parse(text) as unknown;
}
