/** Copies only JSON values, rejecting silent serialization transformations. */
export function requestJson(value: unknown): string {
  const active = new WeakSet<object>();
  const copy = (input: unknown, depth: number): unknown => {
    if (depth > 64) throw new TypeError('JSON nesting limit exceeded');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || (Number.isInteger(input) && !Number.isSafeInteger(input))) throw new TypeError('Unsupported JSON number');
      return input;
    }
    if (typeof input !== 'object' || active.has(input)) throw new TypeError('Unsupported JSON value');
    active.add(input);
    try {
      if (Object.getOwnPropertySymbols(input).length > 0) throw new TypeError('JSON symbol keys are unsupported');
      if (Array.isArray(input)) return Array.from(input, child => copy(child, depth + 1));
      if (![null, Object.prototype].includes(Object.getPrototypeOf(input))) throw new TypeError('JSON requires plain objects');
      return Object.fromEntries(Object.entries(input).map(([name, child]) => [name, copy(child, depth + 1)]));
    } finally { active.delete(input); }
  };
  return JSON.stringify(copy(value, 0));
}
