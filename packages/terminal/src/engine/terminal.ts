import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { ConfigurationError, defineEngine, EngineError, OBSERVED_NAME_LIMIT, OBSERVED_TEXT_LIMIT, resolveExpression, type Engine, type EngineAppDeclaration, type EngineAppCheckInfo, type EngineAttemptContext, type EngineFixtureContext, type EngineHandle, type EngineInitInfo, type EngineSnapshot, type LocatorExpression, type OperationContext, type SemanticNode } from '@e2e-cpp/core/engine';
import { TerminalSession } from '../model/session.ts';
import { boundedInteger, TerminalError, type TerminalCommand, type TerminalDimensions, type TerminalOperation, type TerminalSessionOptions, type TerminalSnapshot } from '../model/types.ts';
import type { TerminalTransport, TerminalTransportFactory } from '../transport/base.ts';
import { NodePtyTransport } from '../transport/node-pty.ts';

export interface TerminalOptions extends TerminalSessionOptions {
  /** Relative to the config directory; the default is that directory. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** A new transport per attempt. The default launches the target's appPath. */
  readonly transportFactory?: TerminalTransportFactory;
}

export interface TerminalFixture {
  write(data: string): Promise<void>;
  press(key: string): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  snapshot(): Promise<TerminalSnapshot>;
  waitFor(pattern: string | RegExp, options?: TerminalOperation): Promise<TerminalSnapshot>;
  /** Raw stream may contain secrets; never forwarded to a model automatically. */
  transcript(): string;
}

function translateError(cause: unknown): never {
  if (cause instanceof EngineError) throw cause;
  if (cause instanceof TerminalError) {
    const code = cause.code === 'UNSUPPORTED_KEY' ? 'UNSUPPORTED_CAPABILITY' : cause.code === 'TIMEOUT' ? 'OPERATION_TIMEOUT' : cause.code === 'ABORTED' ? 'CANCELLED' : cause.code === 'EXITED' || cause.code === 'CLOSED' ? 'NOT_ACTIONABLE' : 'ENGINE_FAILURE';
    throw new EngineError(code, cause.message, { retryable: false, cause });
  }
  throw new EngineError('ENGINE_FAILURE', 'Terminal operation failed', { retryable: false, cause });
}

/** Engine controller. Subclasses may specialize transport or semantic mapping. */
export class TerminalEngine implements Engine {
  readonly name = 'terminal';
  readonly version = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
  readonly spiVersion = 1 as const;
  readonly platform = 'terminal';
  readonly #options: TerminalOptions;
  #command: TerminalCommand | undefined;
  #current: TerminalSession | undefined;
  #attempt: EngineAttemptContext | undefined;
  #lifetime = new AbortController();
  #transition: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  readonly #cleanupFailures: unknown[] = [];
  readonly #releases = new Set<Promise<void>>();
  #fault: unknown;
  #faultedSessions = new WeakSet<TerminalSession>();

  constructor(options: TerminalOptions = {}) {
    boundedInteger(options.columns ?? 80, 'columns', 512);
    boundedInteger(options.rows ?? 24, 'rows', 200);
    this.#options = { ...options };
  }

  validateApp(app: EngineAppDeclaration, info: EngineAppCheckInfo): void {
    if (this.#options.transportFactory === undefined && !app.appPath) {
      throw new ConfigurationError('INVALID_CONFIG', `Target ${info.targetName} requires app.appPath for its terminal executable`);
    }
    if (app.url !== undefined) {
      throw new ConfigurationError('INVALID_CONFIG', `Target ${info.targetName} terminal app supports appPath and launchArguments`);
    }
  }

  async init(info: EngineInitInfo): Promise<void> {
    if (info.app.appPath !== undefined) {
      this.#command = {
        executable: isAbsolute(info.app.appPath) ? info.app.appPath : resolve(info.projectRoot, info.app.appPath),
        args: info.app.launchArguments ?? [], cwd: resolve(info.projectRoot, this.#options.cwd ?? '.'),
        env: { ...info.env, ...this.#options.env },
      };
    }
  }

  protected createTransport(command: TerminalCommand | undefined, dimensions: TerminalDimensions, operation?: { signal: AbortSignal; timeoutMs: number }): Promise<TerminalTransport> | TerminalTransport {
    if (this.#options.transportFactory !== undefined) return this.#options.transportFactory(dimensions, operation);
    if (command === undefined) throw new TerminalError('INVALID_ARGUMENT', 'Terminal executable was not configured');
    return NodePtyTransport.create(command, dimensions);
  }

  protected createSession(transport: TerminalTransport): TerminalSession { return new TerminalSession(transport, this.#options); }

  /** Teardown joins all releases, including a close begun by a cancelled restart. */
  #release(resource: { close(): Promise<void> }): Promise<void> {
    const release = Promise.resolve().then(() => resource.close()).catch((cause: unknown) => {
      this.#cleanupFailures.push(cause);
      throw cause;
    }).finally(() => { this.#releases.delete(release); });
    this.#releases.add(release);
    return release;
  }

  /** Retains an attempt fault even when restart or teardown discards its session. */
  #captureFault(session: TerminalSession): void {
    if (this.#faultedSessions.has(session)) return;
    try { session.assertHealthy(); }
    catch (cause) {
      this.#faultedSessions.add(session);
      this.#fault ??= cause;
    }
  }

  /** Cleanup and health are separate: closing resources must not erase a fault. */
  #releaseSession(session: TerminalSession): Promise<void> {
    this.#captureFault(session);
    return this.#release(session).finally(() => { this.#captureFault(session); });
  }

  /** A launch owns its captured attempt even when a custom factory finishes late. */
  #replace(attempt: EngineAttemptContext, signal: AbortSignal, timeoutMs: number): Promise<void> {
    if (signal.aborted) return Promise.reject(new TerminalError('ABORTED', 'Terminal launch was aborted'));
    if (this.#transition !== undefined || this.#closing !== undefined) return Promise.reject(new EngineError('INVALID_STATE', 'Terminal lifecycle transition is in progress', { retryable: false }));
    boundedInteger(timeoutMs, 'timeoutMs', 2_147_483_647);
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, attempt.signal, this.#lifetime.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new TerminalError('TIMEOUT', 'Terminal launch exceeded its operation budget')), timeoutMs);
    let abort: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(controller.signal.reason instanceof TerminalError ? controller.signal.reason : new TerminalError('ABORTED', 'Terminal launch was aborted'));
      combined.addEventListener('abort', abort, { once: true });
      if (combined.aborted) abort();
    });
    const acquisition = (async () => {
      const current = this.#current;
      this.#current = undefined;
      if (current !== undefined) await this.#releaseSession(current);
      if (combined.aborted || this.#attempt !== attempt) throw new TerminalError('ABORTED', 'Terminal launch was aborted');
      const dimensions = { columns: this.#options.columns ?? 80, rows: this.#options.rows ?? 24 };
      const transport = await this.createTransport(this.#command, dimensions, { signal: combined, timeoutMs });
      if (combined.aborted || this.#attempt !== attempt) {
        await this.#release(transport).catch(() => undefined);
        throw new TerminalError('ABORTED', 'Terminal launch was aborted');
      }
      try { this.#current = this.createSession(transport); }
      catch (cause) {
        try { await this.#release(transport); } catch (cleanup) { throw new AggregateError([cause, cleanup], 'Terminal session creation and cleanup failed', { cause: cleanup }); }
        throw cause;
      }
    })();
    const transition = Promise.race([acquisition, interrupted]).finally(() => {
      clearTimeout(timer);
      combined.removeEventListener('abort', abort);
      controller.abort();
      if (this.#transition === transition) this.#transition = undefined;
    });
    this.#transition = transition;
    return transition;
  }

  protected currentSession(): TerminalSession {
    if (this.#current === undefined) throw new EngineError('INVALID_STATE', 'Terminal session is not open', { retryable: false });
    return this.#current;
  }

  async startAttempt(context: EngineAttemptContext): Promise<void> {
    if (this.#attempt !== undefined || this.#transition !== undefined || this.#closing !== undefined) throw new EngineError('INVALID_STATE', 'Terminal attempt is already open or closing', { retryable: false });
    this.#fault = undefined;
    this.#faultedSessions = new WeakSet<TerminalSession>();
    this.#attempt = context;
    this.#lifetime = new AbortController();
    await this.#replace(context, context.signal, this.#options.timeoutMs ?? 30_000);
    context.environment({ terminal: '@xterm/headless 6.0.0', transport: this.#options.transportFactory === undefined ? 'node-pty' : 'custom' });
  }

  /** Reports each failed session once before verdict or after owned cleanup. */
  async settleAttempt(): Promise<void> {
    if (this.#current !== undefined) this.#captureFault(this.#current);
    if (this.#fault !== undefined) {
      const fault = this.#fault;
      this.#fault = undefined;
      translateError(fault);
    }
  }

  endAttempt(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#lifetime.abort();
    this.#attempt = undefined;
    const closing = (async () => {
      await this.#transition?.catch(() => undefined);
      const current = this.#current;
      this.#current = undefined;
      if (current !== undefined) await this.#releaseSession(current).catch(() => undefined);
      await Promise.allSettled(this.#releases);
      if (this.#cleanupFailures.length > 0) throw new AggregateError(this.#cleanupFailures.splice(0), 'Terminal cleanup failed');
    })().finally(() => { if (this.#closing === closing) this.#closing = undefined; });
    this.#closing = closing;
    return closing;
  }
  async dispose(): Promise<void> { await this.endAttempt(); }

  readonly session = {
    restart: async (context: OperationContext): Promise<void> => {
      const attempt = this.#attempt;
      if (attempt === undefined) throw new EngineError('INVALID_STATE', 'Terminal attempt is not open', { retryable: false });
      try { await this.#replace(attempt, context.signal, context.timeoutMs); }
      catch (cause) { return translateError(cause); }
    },
  };

  /** Terminal rows are text, never inferred buttons or editable fields. */
  protected semanticSnapshot(snapshot: TerminalSnapshot, observed: boolean): EngineSnapshot {
    const clipped = (text: string): string => observed ? text.slice(0, OBSERVED_TEXT_LIMIT) : text;
    return {
      location: snapshot.title === '' ? 'terminal' : snapshot.title,
      viewport: { width: snapshot.columns, height: snapshot.rows },
      root: {
        ref: { id: 'terminal', revision: '' }, role: 'terminal',
        name: (snapshot.title || 'Terminal').slice(0, OBSERVED_NAME_LIMIT), text: clipped(snapshot.text), testId: 'terminal',
        states: { hidden: false, focused: snapshot.exit === undefined },
        attributes: { columns: String(snapshot.columns), rows: String(snapshot.rows), alternate: String(snapshot.alternate), ...(snapshot.exit === undefined ? {} : { exitCode: String(snapshot.exit.exitCode) }) },
        children: snapshot.lines.map((text, row): SemanticNode => ({
          ref: { id: `terminal-row-${row}`, revision: '' }, role: 'text', text: clipped(text),
          testId: `terminal-row-${row}`, states: { hidden: false },
          attributes: { row: String(row) },
        })),
      },
    };
  }

  async observe(context: OperationContext): Promise<EngineSnapshot> {
    try { return this.semanticSnapshot(await this.currentSession().snapshot(context), true); }
    catch (cause) { return translateError(cause); }
  }
  async locate(expression: LocatorExpression, context: OperationContext): Promise<readonly SemanticNode[]> {
    try {
      const snapshot = this.semanticSnapshot(await this.currentSession().snapshot(context), false);
      return resolveExpression(expression, [snapshot.root]);
    } catch (cause) { return translateError(cause); }
  }

  readonly keyboard = {
    type: async (text: string, options: { readonly replace: boolean }, context: OperationContext): Promise<void> => {
      if (options.replace) throw new EngineError('UNSUPPORTED_CAPABILITY', 'A generic terminal has no portable replace-field operation; send explicit keys', { retryable: false });
      try { await this.currentSession().write(text, context); }
      catch (cause) { translateError(cause); }
    },
    press: async (key: string, context: OperationContext): Promise<void> => {
      try { await this.currentSession().press(key, context); }
      catch (cause) { translateError(cause); }
    },
  };

  readonly fixtures = {
    terminal: (context: EngineFixtureContext): TerminalFixture => context.fixture<TerminalFixture>('terminal', {
      write: (data) => this.currentSession().write(data, context.operation()),
      press: (key) => this.currentSession().press(key, context.operation()),
      resize: (columns, rows) => this.currentSession().resize(columns, rows, context.operation()),
      snapshot: () => this.currentSession().snapshot(context.operation()),
      waitFor: (pattern, options = {}) => this.currentSession().waitFor(pattern, { ...options, signal: context.signal, timeoutMs: options.timeoutMs ?? context.timeouts.assertion }),
      transcript: () => this.currentSession().transcript(),
    }, {
      write: { kind: 'resource', label: () => 'terminal.write' },
      press: { kind: 'resource', label: () => 'terminal.press' },
      resize: { kind: 'resource', label: (columns, rows) => `terminal.resize(${columns}, ${rows})` },
      snapshot: { kind: 'resource', label: () => 'terminal.snapshot' },
      waitFor: { kind: 'assertion', timeout: false, label: () => 'terminal.waitFor' },
    }),
  };
}

export function terminal(options: TerminalOptions = {}): EngineHandle { return defineEngine(new TerminalEngine(options)); }
