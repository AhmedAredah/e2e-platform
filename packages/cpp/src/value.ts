import { invalid } from './protocol.ts';

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
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
    } else if (text[i] === '[' || text[i] === '{') {
      if (++depth > 64) invalid();
    } else if (text[i] === ']' || text[i] === '}') depth--;
  }
  try {
    return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (context?.source === undefined) invalid();
      return new ExactNumber(context.source);
    }) as unknown;
  } catch { invalid(); }
}
