import { TerminalTransport } from '../src/transport/base.ts';
import type { TerminalExit } from '../src/model/types.ts';

/** Deliberate subclass used to exercise the public transport extension seam. */
export class MemoryTransport extends TerminalTransport {
  readonly writes: string[] = [];
  readonly sizes: [number, number][] = [];
  readonly #data = new Set<(data: string) => void>();
  readonly #exits = new Set<(exit: TerminalExit) => void>();
  closed = 0;
  write(data: string): void { this.writes.push(data); }
  resize(columns: number, rows: number): void { this.sizes.push([columns, rows]); }
  onData(listener: (data: string) => void): () => void { this.#data.add(listener); return () => { this.#data.delete(listener); }; }
  onExit(listener: (exit: TerminalExit) => void): () => void { this.#exits.add(listener); return () => { this.#exits.delete(listener); }; }
  async close(): Promise<void> { this.closed += 1; }
  emit(data: string): void { for (const listener of this.#data) listener(data); }
  finish(exit: TerminalExit): void { for (const listener of this.#exits) listener(exit); }
}
