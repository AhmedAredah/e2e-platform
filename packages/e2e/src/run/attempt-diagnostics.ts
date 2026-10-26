/** Bounded engine diagnostics, retained only after secret redaction. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineAppLog } from '../engine/index.ts';
import type { ArtifactSink } from './fixtures.ts';

export class AttemptDiagnostics {
  private logs = '';
  private readonly values = new Map<string, string>();
  private remaining = 262_144;
  private overflowed = false;

  /** Retains at most a quarter mebibyte of diagnostic text per attempt. */
  readonly appLog = (event: EngineAppLog): void => {
    if (this.overflowed || typeof event.text !== 'string') return;
    const size = Buffer.byteLength(event.text);
    if (size > this.remaining) {
      // Discard the entire stream: an earlier chunk could contain a secret's
      // prefix whose suffix is in the chunk that exceeds this buffer.
      this.logs = '[Application diagnostics omitted: buffer limit exceeded]\n';
      this.overflowed = true;
      return;
    }
    // Preserve chunk boundaries without inserting bytes: a secret split
    // between process-output callbacks must still match the final ledger.
    this.logs += event.text;
    this.remaining -= size;
  };

  /** Limits metadata count and length independently from application output. */
  readonly environment = (values: Readonly<Record<string, string>>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (this.values.size >= 64 || typeof value !== 'string' || Buffer.byteLength(key) > 128 || Buffer.byteLength(value) > 2048) continue;
      this.values.set(key, value);
    }
  };

  /** Writes only redacted bytes, including values learned after a log arrived. */
  async publish(sink: ArtifactSink, redact: (text: string) => string): Promise<void> {
    if (this.logs !== '') {
      await writeFile(path.join(sink.dir, 'application.log'), redact(this.logs), { mode: 0o600 });
      sink.register('log', 'application.log', { redaction: 'complete' });
    }
    if (this.values.size !== 0) {
      const values = [...this.values].map(([key, value]) => [redact(key), redact(value)]);
      await writeFile(path.join(sink.dir, 'environment.json'), JSON.stringify(Object.fromEntries(values), null, 2) + '\n', { mode: 0o600 });
      sink.register('log', 'environment.json', { redaction: 'complete' });
    }
  }
}
