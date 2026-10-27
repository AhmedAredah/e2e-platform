/** A bounded, closed request protocol shared with the C++17 test client. */
export const MAX_LINE_BYTES = 1024 * 1024;
export const MAX_REQUESTS = 10_000;

/** Rejects malformed input without quoting application-controlled content. */
export function invalid(): never { throw new Error('Invalid C++ test protocol'); }

/** Checks a plain JSON object and, optionally, its exact allowed keys. */
export function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (keys !== undefined && Object.keys(result).some(key => !keys.includes(key))) invalid();
  return result;
}

/** Reads a bounded string, preserving legitimate empty values. */
export function string(value: unknown, max = MAX_LINE_BYTES): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || value.includes('\u0000')) invalid();
  return value;
}

/** Reads an optional positive timeout within the supported timer range. */
export function timeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) invalid();
  return value;
}

export interface Request { readonly protocol: 2; readonly id: number; readonly method: string; readonly params: Record<string, unknown> }

/** Decodes UTF-8 strictly and bounds request shape before dispatch. */
export function parseRequest(bytes: Buffer): Request {
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid(); }
  const data = record(raw, ['protocol', 'id', 'method', 'params']);
  if (data.protocol !== 2 || !Number.isSafeInteger(data.id) || (data.id as number) <= 0) invalid();
  return { protocol: 2, id: data.id as number, method: string(data.method, 100), params: record(data.params) };
}

/** Incremental byte framing with a strict limit before JSON allocation. */
export class LineDecoder {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  /** Emits complete frames and rejects empty, oversized or nonterminated streams. */
  push(bytes: Buffer, receive: (line: Buffer) => void): void {
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      const part = bytes.subarray(offset, end < 0 ? bytes.length : end);
      if (this.pendingBytes + part.length > MAX_LINE_BYTES) invalid();
      this.pending.push(part); this.pendingBytes += part.length;
      if (end < 0) return;
      if (this.pendingBytes === 0) invalid();
      const line = Buffer.concat(this.pending, this.pendingBytes); this.pending = []; this.pendingBytes = 0;
      receive(line); offset = end + 1;
    }
  }
  /** Requires a complete final newline. */
  finish(): void { if (this.pendingBytes !== 0) invalid(); }
}
