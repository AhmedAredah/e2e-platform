import { describe, expect, it } from 'vitest';
import { OutputLineReader } from '../src/engine/output-lines.ts';

describe('bounded native output decoding before redaction', () => {
  it('reassembles credentials and multibyte UTF-8 before exposing a line', () => {
    const lines: string[] = [];
    const token = 'do-not-log-this';
    const reader = new OutputLineReader((line) => lines.push(line.replaceAll(token, '[redacted]')), () => {});
    const bytes = Buffer.from(`café ${token}\r\n`);
    for (const byte of bytes) reader.write(Buffer.from([byte]));
    expect(lines).toEqual(['café [redacted]']);
  });

  it('discards an oversized whole line without publishing a credential fragment', () => {
    const lines: string[] = [];
    let overflows = 0;
    const reader = new OutputLineReader((line) => lines.push(line), () => { overflows++; }, 8);
    reader.write(Buffer.from('long-sen'));
    reader.write(Buffer.from('sitive-value\nnext\n'));
    expect(lines).toEqual(['next']);
    expect(overflows).toBe(1);
  });
});

it('flushes an unterminated UTF-8 final line once and never exposes overflow', () => {
  const lines: string[] = [];
  const reader = new OutputLineReader((line) => lines.push(line.replaceAll('secret', '[redacted]')), () => {});
  for (const byte of Buffer.from('fatal café secret')) reader.write(Buffer.from([byte]));
  reader.end(); reader.end(); reader.write(Buffer.from('ignored'));
  expect(lines).toEqual(['fatal café [redacted]']);
  const bounded = new OutputLineReader((line) => lines.push(line), () => {}, 4);
  bounded.write(Buffer.from('too long')); bounded.end();
  expect(lines).toHaveLength(1);
});
