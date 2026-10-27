import { describe, expect, test } from 'vitest';
import { LineDecoder, MAX_LINE_BYTES, parseRequest } from '../src/protocol.ts';

describe('C++ protocol framing', () => {
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
