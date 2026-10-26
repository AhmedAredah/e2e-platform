import { describe, expect, test } from 'vitest';
import { encodeKey } from '../src/engine/keys.ts';
describe('xterm key encoding', () => {
  test.each([
    ['Enter', '\r'], ['ArrowUp', '\x1b[A'], ['Control+c', '\x03'], ['Shift+Tab', '\x1b[Z'],
    ['Control+ArrowRight', '\x1b[1;5C'], ['Alt+x', '\x1bx'], ['F12', '\x1b[24~'], ['Delete', '\x1b[3~'],
  ])('%s', (key, bytes) => { expect(encodeKey(key)).toBe(bytes); });
  test('rejects impossible or unknown shortcuts instead of silently reinterpreting them', () => {
    expect(() => encodeKey('Meta+a')).toThrow('portable terminal');
    expect(() => encodeKey('Control+😀')).toThrow('supported terminal');
    expect(() => encodeKey('UnknownKey')).toThrow('Unsupported terminal key');
  });
});
