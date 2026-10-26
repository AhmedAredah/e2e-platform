/** Canonical decimal spelling, without expanding potentially enormous exponents. */
function canonicalDecimal(input: string): string {
  const match = /^([+-]?)(\d*\.?\d*)(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) throw new SyntaxError('Invalid decimal number');
  const mantissa = match[2]!;
  const point = mantissa.indexOf('.');
  const fraction = point < 0 ? 0 : mantissa.length - point - 1;
  let digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (digits === '') return '0';
  let exponent = BigInt(match[3] ?? '0') - BigInt(fraction);
  const trimmed = digits.replace(/0+$/, '');
  exponent += BigInt(digits.length - trimmed.length);
  digits = trimmed;
  return `${match[1] === '-' ? '-' : ''}${digits}e${exponent}`;
}

/** Refuses numeric parsing that silently changes decimal output or exceeds binary64 range. */
export function parseDecimal(input: string, unsafeIntegers: 'allow' | 'reject' = 'reject', decimalPrecision: 'exact' | 'binary64' = 'exact'): number {
  if (input.length > 4096) throw new RangeError('Numeric literal exceeds the 4096-character parsing budget');
  const value = Number(input);
  if (!Number.isFinite(value) || (decimalPrecision === 'exact' && canonicalDecimal(input) !== canonicalDecimal(String(value)))) {
    throw new RangeError(`Decimal cannot round-trip through JavaScript binary64: ${input.slice(0, 100)}; preserve high-precision values as strings`);
  }
  if (unsafeIntegers !== 'allow' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new RangeError('Unsafe integer; preserve C++ int64/uint64 output as strings');
  }
  return value;
}

/** Validates JSON number tokens before JSON.parse can discard their precision. */
export function validateJsonNumbers(text: string, unsafeIntegers: 'allow' | 'reject' = 'reject', decimalPrecision: 'exact' | 'binary64' = 'exact'): void {
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
    } else if (text[i] === '-' || (text[i]! >= '0' && text[i]! <= '9')) {
      number.lastIndex = i;
      const match = number.exec(text);
      if (match) { parseDecimal(match[0], unsafeIntegers, decimalPrecision); i = number.lastIndex - 1; }
    }
  }
}
