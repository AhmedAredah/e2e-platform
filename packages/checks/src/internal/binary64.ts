interface Binary { readonly coefficient: bigint; readonly exponent: number }

/** Decomposes finite binary64 values exactly, including subnormals and signed zero. */
function binary(value: number): Binary {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  return { coefficient: (bits >> 63n ? -1n : 1n) * (exponent === 0 ? fraction : fraction + (1n << 52n)), exponent: exponent === 0 ? -1074 : exponent - 1075 };
}

function atMost(a: Binary, b: Binary): boolean {
  const exponent = Math.min(a.exponent, b.exponent);
  return (a.coefficient << BigInt(a.exponent - exponent)) <= (b.coefficient << BigInt(b.exponent - exponent));
}

/** Compares the exact represented values and error budgets without rounded subtraction/division. */
export function withinTolerance(actual: number, expected: number, absolute: number, relative: number): boolean {
  if (actual === expected) return true;
  const a = binary(actual), b = binary(expected);
  const exponent = Math.min(a.exponent, b.exponent);
  const signed = (a.coefficient << BigInt(a.exponent - exponent)) - (b.coefficient << BigInt(b.exponent - exponent));
  const difference = { coefficient: signed < 0 ? -signed : signed, exponent };
  if (atMost(difference, binary(absolute))) return true;
  const r = binary(relative), scale = binary(Math.max(Math.abs(actual), Math.abs(expected)));
  return atMost(difference, { coefficient: r.coefficient * scale.coefficient, exponent: r.exponent + scale.exponent });
}
