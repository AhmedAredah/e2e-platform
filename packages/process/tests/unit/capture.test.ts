import { describe, expect, it } from 'vitest';
import { BoundedCapture } from '../../src/capture/bounded.ts';

describe('BoundedCapture', () => {
  it('counts every byte and owns only an independent prefix', () => {
    const capture = new BoundedCapture(3);
    const input = Buffer.from([0, 1, 255, 9]);
    capture.append(input);
    input.fill(7);
    const first = capture.snapshot();
    expect(first).toEqual({ bytes: Buffer.from([0, 1, 255]), totalBytes: 4, truncated: true });
    first.bytes.fill(8);
    capture.append(Buffer.from('extra'));
    expect(capture.snapshot()).toEqual({ bytes: Buffer.from([0, 1, 255]), totalBytes: 9, truncated: true });
  });

  it('supports counter-only capture without retaining output', () => {
    const capture = new BoundedCapture(0);
    capture.append(Buffer.alloc(100_000));
    expect(capture.snapshot()).toEqual({ bytes: Buffer.alloc(0), totalBytes: 100_000, truncated: true });
  });
});
