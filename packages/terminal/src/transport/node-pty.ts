import { terminateProcessTree } from '@e2e-cpp/process';
import { boundedInteger, TerminalError, type TerminalCommand, type TerminalDimensions, type TerminalExit } from '../model/types.ts';
import { TerminalTransport } from './base.ts';
import type { IPty } from 'node-pty';

/** Owns one forkpty/ConPTY child. The optional native module loads only here. */
export class NodePtyTransport extends TerminalTransport {
  readonly #pty: IPty;
  readonly pid: number;
  #closing: Promise<void> | undefined;
  #exited = false;

  private constructor(pty: IPty) {
    super();
    this.#pty = pty;
    this.pid = pty.pid;
    pty.onExit(() => { this.#exited = true; });
  }

  static async create(command: TerminalCommand, dimensions: TerminalDimensions): Promise<NodePtyTransport> {
    boundedInteger(dimensions.columns, 'columns', 512);
    boundedInteger(dimensions.rows, 'rows', 200);
    if (command.executable.trim() === '') throw new TerminalError('INVALID_ARGUMENT', 'Terminal executable is required');
    let native: typeof import('node-pty');
    try { native = await import('node-pty'); }
    catch (cause) { throw new TerminalError('DEPENDENCY_MISSING', 'Install the optional node-pty peer with its native binary to launch a PTY', { cause }); }
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) if (value !== undefined) environment[name] = value;
    for (const [name, value] of Object.entries(command.env ?? {})) {
      if (value === undefined) delete environment[name]; else environment[name] = value;
    }
    environment.TERM ??= 'xterm-256color';
    try {
      const pty = native.spawn(command.executable, [...command.args ?? []], {
        name: 'xterm-256color', cols: dimensions.columns, rows: dimensions.rows,
        cwd: command.cwd ?? process.cwd(), env: environment,
      });
      return new NodePtyTransport(pty);
    } catch (cause) { throw new TerminalError('TRANSPORT_FAILED', 'Could not launch terminal process', { cause }); }
  }

  write(data: string): void {
    if (this.#closing !== undefined || this.#exited) throw new TerminalError('EXITED', 'Terminal process is no longer accepting input');
    this.#pty.write(data);
  }
  resize(columns: number, rows: number): void { this.#pty.resize(columns, rows); }
  onData(listener: (data: string) => void): () => void { const subscription = this.#pty.onData(listener); return () => { subscription.dispose(); }; }
  onExit(listener: (exit: TerminalExit) => void): () => void { const subscription = this.#pty.onExit(listener); return () => { subscription.dispose(); }; }
  close(): Promise<void> {
    this.#closing ??= (async () => {
      // forkpty creates a session/process-group leader on POSIX. Windows uses
      // taskkill while the root is alive; escaped/breakaway jobs are not contained.
      let cleanupFailure: unknown;
      try {
        if (process.platform !== 'win32' || !this.#exited) await terminateProcessTree(this.pid, { graceMs: 100 });
      } catch (cause) { cleanupFailure = cause; }
      try { this.#pty.kill(); }
      catch (cause) {
        if (!this.#exited) {
          let absent = false;
          try { process.kill(this.pid, 0); }
          catch (probe) { absent = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
          if (!absent) cleanupFailure ??= new TerminalError('TRANSPORT_FAILED', 'Terminal cleanup failed', { cause });
        }
      }
      if (cleanupFailure !== undefined) throw cleanupFailure;
    })();
    return this.#closing;
  }
}
