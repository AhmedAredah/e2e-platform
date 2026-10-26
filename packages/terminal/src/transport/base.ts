import type { TerminalDimensions, TerminalExit, TerminalOperation } from '../model/types.ts';

/** A real PTY or caller-supplied terminal transport. Data is a VT byte stream. */
export abstract class TerminalTransport {
  readonly pid: number | undefined = undefined;
  abstract write(data: string): void | Promise<void>;
  abstract resize(columns: number, rows: number): void | Promise<void>;
  abstract onData(listener: (data: string) => void): () => void;
  abstract onExit(listener: (exit: TerminalExit) => void): () => void;
  /** Must be idempotent and release the owned process and transport resources. */
  abstract close(): Promise<void>;
}

export type TerminalTransportFactory = (dimensions: TerminalDimensions, operation?: TerminalOperation) => TerminalTransport | Promise<TerminalTransport>;
