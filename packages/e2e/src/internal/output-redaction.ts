/** Bounded buffering for output whose chunks can split secret values. */
import { StringDecoder } from 'node:string_decoder';
import { processSecrets, type SecretLedger } from './redact.ts';

/** Keeps only an undecidable suffix so split writes never expose a known secret prefix. */
export class StreamingRedactor {
  private pending = '';
  private readonly decoder = new StringDecoder('utf8');
  constructor(private readonly ledger: SecretLedger) {}

  /** Accepts UTF-8 bytes or text; returns the prefix that can safely leave this process. */
  write(chunk: string | Uint8Array): string {
    this.pending += typeof chunk === 'string' ? this.decoder.end() + chunk : this.decoder.write(Buffer.from(chunk));
    const forms = this.ledger.forms();
    const longest = Math.max(1, ...forms.map((form) => form.length));
    if (longest > 65_536) {
      this.pending = '';
      return this.ledger.redact('[output withheld: registered secret exceeds streaming redaction limit]\n');
    }
    let cut = Math.max(0, this.pending.length - longest + 1);
    if (forms.length > 0) {
      const pattern = new RegExp(forms.map((form) => form.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
      // Match the same leftmost, non-overlapping spans as the redactor. Walking
      // every overlapping spelling backwards could retain an entire run of a's
      // for the secret "aa", growing the suffix without bound.
      for (const match of this.pending.matchAll(pattern)) {
        if (match.index >= cut) break;
        if (match.index + match[0].length > cut) { cut = match.index; break; }
      }
    }
    const safe = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    return this.ledger.redact(safe);
  }

  /** Finalizes a logical stream at a unit boundary or process shutdown. */
  flush(): string {
    const safe = this.ledger.redact(this.pending + this.decoder.end());
    this.pending = '';
    return safe;
  }
}

/** Holds config-module console output until its static declarations have been registered. */
export async function protectConfigOutput<T>(load: () => Promise<T>): Promise<T> {
  const held: { stream: NodeJS.WriteStream; write: NodeJS.WriteStream['write']; chunks: Buffer[]; bytes: number; overflow: boolean }[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    const state = { stream, write: stream.write, chunks: [] as Buffer[], bytes: 0, overflow: false };
    held.push(state);
    stream.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8') : Buffer.from(chunk);
      state.bytes += bytes.length;
      if (state.bytes <= 1024 * 1024) state.chunks.push(bytes);
      else { state.chunks = []; state.overflow = true; }
      const done = typeof encoding === 'function' ? encoding : callback;
      if (done !== undefined) queueMicrotask(() => done());
      return true;
    }) as NodeJS.WriteStream['write'];
  }
  let success = false;
  try { const value = await load(); success = true; return value; }
  finally {
    for (const state of held) state.stream.write = state.write;
    for (const state of held) {
      const text = !success || state.overflow
        ? (state.bytes > 0 ? '[config output withheld until secrets can be resolved]\n' : '')
        : processSecrets.redact(Buffer.concat(state.chunks).toString('utf8'));
      if (text !== '') state.write.call(state.stream, processSecrets.redact(text));
    }
  }
}

/** Guards the runner's own stdout/stderr, including in-process test and reporter output. */
export async function protectProcessOutput<T>(work: () => Promise<T>): Promise<T> {
  const restore: (() => void)[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write;
    const filter = new StreamingRedactor(processSecrets);
    stream.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
      const done = typeof encoding === 'function' ? encoding : callback;
      const text = filter.write(typeof chunk === 'string' && typeof encoding === 'string' ? Buffer.from(chunk, encoding) : chunk);
      if (text !== '') return original.call(stream, text, 'utf8', done);
      if (done !== undefined) queueMicrotask(() => done());
      return true;
    }) as NodeJS.WriteStream['write'];
    restore.push(() => { stream.write = original; const tail = filter.flush(); if (tail !== '') original.call(stream, tail); });
  }
  try { return await work(); } finally { for (const finish of restore) finish(); }
}
