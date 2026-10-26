import { StringDecoder } from 'node:string_decoder';

/** Decode before redaction so UTF-8 and credentials split across chunks stay whole. */
export class OutputLineReader {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private discarding = false;
  private ended = false;

  constructor(private readonly line: (text: string) => void, private readonly overflow: () => void, private readonly maxChars = 65_536) {}

  write(bytes: Buffer): void {
    if (this.ended) return;
    const text = this.decoder.write(bytes);
    let start = 0;
    for (;;) {
      const end = text.indexOf('\n', start);
      if (end < 0) break;
      this.append(text.slice(start, end));
      if (!this.discarding) this.line(this.pending.replace(/\r$/, ''));
      this.pending = '';
      this.discarding = false;
      start = end + 1;
    }
    this.append(text.slice(start));
  }

  /** Flushes a final unterminated line once, preserving the same bounds and redaction path. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.append(this.decoder.end());
    if (!this.discarding && this.pending !== '') this.line(this.pending.replace(/\r$/, ''));
    this.pending = '';
  }

  private append(text: string): void {
    if (this.discarding) return;
    if (this.pending.length + text.length > this.maxChars) {
      this.pending = '';
      this.discarding = true;
      this.overflow();
    } else this.pending += text;
  }
}
