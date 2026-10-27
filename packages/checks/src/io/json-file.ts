import { createReadStream } from 'node:fs';
import { TextDecoder } from 'node:util';
import { positiveInteger } from '../internal/options.ts';
import { parseJson } from './json.ts';
import type { JsonReadOptions } from '../types.ts';

/** Reads JSON with a byte limit that still applies if the file grows during reading. */
export async function readJsonFile(path: string, maxBytes = 16 * 1024 * 1024, options: JsonReadOptions = {}): Promise<unknown> {
  if (options.decimalPrecision !== undefined && !['exact', 'binary64'].includes(options.decimalPrecision)) throw new TypeError('decimalPrecision must be exact or binary64');
  positiveInteger(maxBytes, 16 * 1024 * 1024, 'maxBytes');
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) { stream.destroy(); throw new RangeError(`JSON file exceeds ${maxBytes} bytes`); }
    chunks.push(bytes);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  return parseJson(text, options);
}
