import { describe, expect, test } from 'vitest';
import { LineDecoder, MAX_LINE_BYTES, parseRequest } from '../src/protocol.ts';
import { decodeJson } from '../src/json.ts';
import { assertionValue } from '../src/value.ts';

describe('C++ protocol framing', () => {
  test('rejects duplicate keys before dispatch, discovery and exact assertions', () => {
    for (const text of ['{"protocol":1,"protocol":2}', '{"tests":[],"te\\u0073ts":["case"]}', '{"nested":{"x":1,"x":2}}']) {
      expect(() => decodeJson(Buffer.from(text))).toThrow('Invalid C++ test protocol');
      expect(() => assertionValue(text)).toThrow('Invalid C++ test protocol');
    }
    expect(() => parseRequest(Buffer.from('{"protocol":1,"protocol":2,"id":1,"method":"case.start","params":{"name":"a"}}'))).toThrow();
  });
  test('enforces depth and byte budgets without narrowing assertion operands', () => {
    expect(decodeJson(Buffer.from('['.repeat(64) + '0' + ']'.repeat(64)))).toBeInstanceOf(Array);
    for (const depth of [65, 10000]) {
      const text = '['.repeat(depth) + '0' + ']'.repeat(depth);
      expect(() => decodeJson(Buffer.from(text))).toThrow();
      expect(() => assertionValue(text)).toThrow();
    }
    expect(() => decodeJson(Buffer.alloc(MAX_LINE_BYTES + 1, 32))).toThrow();
    expect(() => decodeJson(Buffer.from('{"x":1,}'))).toThrow();
    expect(() => decodeJson(Buffer.from('[1,]'))).toThrow();
    expect(assertionValue('{"x":18446744073709551615}')).not.toEqual(assertionValue('{"x":18446744073709551614}'));
    expect(decodeJson(Buffer.from('{"quoted":"\\\"{1:2}","nested":{"x":1},"x":2}'))).toMatchObject({x:2});
  });
  test('preserves UTF-8 split across byte chunks and multiple frames', () => {
    const decoder = new LineDecoder();
    const input = Buffer.from(JSON.stringify({ protocol: 2, id: 1, method: 'expect.equal', params: { actual: '日本語', expected: '日本語' } }) + '\n');
    const frames: Buffer[] = [];
    for (const byte of input) decoder.push(Buffer.from([byte]), line => frames.push(line));
    decoder.finish();
    expect(parseRequest(frames[0]!)).toMatchObject({ params: { actual: '日本語' } });
  });
  test('rejects oversize before newline, incomplete final frame, invalid UTF-8 and fields', () => {
    expect(() => new LineDecoder().push(Buffer.alloc(MAX_LINE_BYTES + 1, 120), () => {})).toThrow();
    const decoder = new LineDecoder(); decoder.push(Buffer.from('{}'), () => {});
    expect(() => decoder.finish()).toThrow();
    expect(() => parseRequest(Buffer.from([0xff]))).toThrow();
    for (const value of [{ protocol: 3, id: 1, method: 'x', params: {} }, { protocol: 2, id: 0, method: 'x', params: {} }, { protocol: 2, id: 1, method: 'x', params: {}, extra: true }]) expect(() => parseRequest(Buffer.from(JSON.stringify(value)))).toThrow();
  });
});
