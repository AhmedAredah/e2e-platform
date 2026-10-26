import type { ProcessCapture } from '../types.ts';

/** Copied, bounded chunks prevent a small prefix from retaining a large backing buffer. */
export class BoundedCapture {
  private readonly chunks: Buffer[] = [];
  private length = 0;
  private total = 0;

  constructor(private readonly limit: number) {}

  /** Appends bytes while retaining at most the configured prefix. */
  append(bytes: Buffer): void {
    this.total += bytes.length;
    const take = Math.min(bytes.length, this.limit - this.length);
    let offset = 0;
    while (offset < take) {
      const inBlock = this.length % 65_536;
      if (inBlock === 0) this.chunks.push(Buffer.allocUnsafe(Math.min(65_536, this.limit - this.length)));
      const block = this.chunks[this.chunks.length - 1]!;
      const count = Math.min(take - offset, block.length - inBlock);
      bytes.copy(block, inBlock, offset, offset + count);
      this.length += count;
      offset += count;
    }
  }

  /** Returns an independent snapshot; consumers cannot mutate retained capture data. */
  snapshot(): ProcessCapture {
    return { bytes: Buffer.concat(this.chunks, this.length), totalBytes: this.total, truncated: this.total > this.length };
  }
}
