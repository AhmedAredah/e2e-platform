import { invalid, MAX_LINE_BYTES } from './limits.ts';

/** Checks the original structure before JSON.parse can erase duplicate object keys. */
class JsonStructure {
  private offset = 0;
  constructor(private readonly text: string) {}

  validate(): void {
    this.value(0);
    this.space();
    if (this.offset !== this.text.length) invalid();
  }

  private space(): void { while (/[\x20\t\r\n]/.test(this.text[this.offset] ?? 'x')) this.offset++; }

  private quoted(): string {
    const start = this.offset++;
    while (this.offset < this.text.length) {
      const character = this.text[this.offset++];
      if (character === '\\') this.offset++;
      else if (character === '"') return JSON.parse(this.text.slice(start, this.offset)) as string;
    }
    return invalid();
  }

  private value(depth: number): void {
    if (depth > 64) invalid();
    this.space();
    const start = this.offset;
    const character = this.text[this.offset];
    if (character === '{' || character === '[') {
      this.offset++;
      const closing = character === '{' ? '}' : ']';
      const keys = new Set<string>();
      this.space();
      if (this.text[this.offset] === closing) { this.offset++; return; }
      for (;;) {
        this.space();
        if (character === '{') {
          if (this.text[this.offset] !== '"') invalid();
          const key = this.quoted();
          if (keys.has(key)) invalid();
          keys.add(key);
          this.space();
          if (this.text[this.offset++] !== ':') invalid();
        }
        this.value(depth + 1);
        this.space();
        const separator = this.text[this.offset++];
        if (separator === closing) return;
        if (separator !== ',') invalid();
      }
    }
    if (character === '"') { this.quoted(); return; }
    while (this.offset < this.text.length && !/[\x20\t\r\n,\]}]/.test(this.text[this.offset]!)) this.offset++;
    if (start === this.offset) invalid();
  }
}

/** Applies the same byte, duplicate-key and nesting limits to frames and exact assertion texts. */
export function validateJsonText(text: string): void {
  try {
    if (Buffer.byteLength(text) > MAX_LINE_BYTES) invalid();
    new JsonStructure(text).validate();
  } catch { invalid(); }
}

/** Decodes bounded UTF-8 without replacement characters or duplicate-key normalization. */
export function decodeJson(bytes: Uint8Array): unknown {
  try {
    if (bytes.byteLength > MAX_LINE_BYTES) invalid();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    validateJsonText(text);
    return JSON.parse(text) as unknown;
  } catch { invalid(); }
}
