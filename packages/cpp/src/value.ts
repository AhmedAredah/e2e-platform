import { invalid } from './protocol.ts';
import { validateJsonText } from './json.ts';

/** Keeps a JSON number's exact decimal value outside JavaScript binary64 conversion. */
class ExactNumber {
  readonly value: string;
  constructor(source: string) {
    if (source.length > 4096) invalid();
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if (match === null) invalid();
    let digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, '');
    if (digits === '') { this.value = '0'; return; }
    let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
    const trimmed = digits.replace(/0+$/, '');
    exponent += BigInt(digits.length - trimmed.length);
    digits = trimmed;
    this.value = `${match[1]}${digits}e${exponent}`;
  }
}

/** Decodes assertion values without losing integers, decimals or nested numeric values. */
export function assertionValue(text: string): unknown {
  validateJsonText(text);
  try {
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (context?.source === undefined) invalid();
      return new ExactNumber(context.source);
    }) as unknown;
  } catch { invalid(); }
}
