/** Bounded buffering for output whose chunks can split secret values. */
import { StringDecoder } from 'node:string_decoder';
import { processSecrets, type SecretLedger } from './redact.ts';

const originalWriters = new WeakMap<NodeJS.WriteStream, NodeJS.WriteStream['write']>();

/** Writes already-sanitized structured output without filtering its serialized protocol bytes. */
export function writeStructuredOutput(stream: NodeJS.WriteStream, chunk: string | Uint8Array, done?: (error?: Error | null) => void): boolean {
  return (originalWriters.get(stream) ?? stream.write).call(stream, chunk, 'utf8', done);
}

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

  /**
   * Finalizes a logical stream. At an ownership boundary, omit a suffix that
   * could begin a secret; a later owner's write must not complete exposed text.
   */
  flush(discardIncomplete = false): string {
    let text = this.ledger.redact(this.pending + this.decoder.end());
    if (discardIncomplete) {
      let withheld = 0;
      for (const form of this.ledger.forms()) {
        if (form.length > 65_536) { text = ''; break; }
        withheld = Math.max(withheld, incompleteSuffixLength(text, form));
      }
      if (withheld > 0) text = text.slice(0, -withheld);
    }
    this.pending = '';
    return text;
  }
}

/** Longest suffix that is a strict prefix of a secret, in linear time. */
function incompleteSuffixLength(text: string, form: string): number {
  const prefix = new Uint32Array(form.length);
  for (let index = 1, matched = 0; index < form.length; index += 1) {
    while (matched > 0 && form[index] !== form[matched]) matched = prefix[matched - 1]!;
    if (form[index] === form[matched]) matched += 1;
    prefix[index] = matched;
  }
  let matched = 0;
  for (let index = Math.max(0, text.length - form.length + 1); index < text.length; index += 1) {
    while (matched > 0 && text[index] !== form[matched]) matched = prefix[matched - 1]!;
    if (text[index] === form[matched]) matched += 1;
  }
  return matched;
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
    const previous = originalWriters.get(stream);
    originalWriters.set(stream, previous ?? original);
    const filter = new StreamingRedactor(processSecrets);
    stream.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
      const done = typeof encoding === 'function' ? encoding : callback;
      const text = filter.write(typeof chunk === 'string' && typeof encoding === 'string' ? Buffer.from(chunk, encoding) : chunk);
      if (text !== '') return original.call(stream, text, 'utf8', done);
      if (done !== undefined) queueMicrotask(() => done());
      return true;
    }) as NodeJS.WriteStream['write'];
    restore.push(() => {
      stream.write = original;
      if (previous === undefined) originalWriters.delete(stream);
      else originalWriters.set(stream, previous);
      const tail = filter.flush();
      if (tail !== '') original.call(stream, tail);
    });
  }
  try { return await work(); } finally { for (const finish of restore) finish(); }
}
