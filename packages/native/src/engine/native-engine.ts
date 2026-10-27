import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startProcess, type ProcessSession } from '@e2e-platform/process';
import {
  ConfigurationError, EngineError, defineEngine, resolveExpression,
  type EngineAppDeclaration, type EngineAttemptContext, type EngineCleanupContext,
  type EngineHandle, type EngineInitInfo, type EngineSnapshot, type LocatorAction,
  type LocatorActionKind, type NodeRef, type OperationContext,
} from '@e2e-platform/core/engine';
import { JsonRpcTcpTransport, cancelled, isRecord } from '../transport/json-rpc-tcp.ts';
import type { NativeTransport, RequestContext } from '../transport/native-transport.ts';
import { NativeDriver, type NativeInitialization, type NativeWindow } from '../driver/native-driver.ts';
import { RpcNativeDriver } from '../driver/rpc-native-driver.ts';
import { validateNativeOptions, type NativeOptions } from '../options.ts';
import { OutputLineReader } from './output-lines.ts';
import type { NativeProcessLaunch } from './native-process.ts';
import { NativeActionability } from './actionability.ts';
import { NativeProfileWorkspace } from './profile-workspace.ts';
import { NativeActionTimeline } from './action-timeline.ts';
import { createNativeFixture } from '../fixtures/native-app.ts';

const DEFAULT_MESSAGE_LIMIT = 16 * 1024 * 1024;
const CLEANUP_ERROR_CODES = new Set(['EPIPE', 'ECONNRESET', 'EPERM', 'EACCES', 'ESRCH', 'EBADF',
  'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ABORT_ERR',
  'PROCESS_CLEANUP_FAILED', 'PROCESS_IO_FAILED', 'PROCESS_STDIN_CLOSED']);

/** Retain actionable cleanup categories without publishing arbitrary error data. */
function cleanupCodes(error: unknown): string {
  const codes: string[] = [];
  try {
    for (let depth = 0; depth < 3 && isRecord(error); depth++) {
      if (typeof error.code === 'string' && CLEANUP_ERROR_CODES.has(error.code)) codes.push(error.code);
      error = error.cause;
    }
  } catch { /* Extension error objects can have throwing getters. */ }
  return codes.join('/') || 'unclassified';
}

export class NativeEngine {
  private info: EngineInitInfo | undefined;
  private attempt: EngineAttemptContext | undefined;
  private process: ProcessSession | undefined;
  private driver: NativeDriver | undefined;
  private unsubscribe: (() => void) | undefined;
  private disconnectSubscription: (() => void) | undefined;
  private rootId: string | undefined;
  private screenshotCounter = 0;
  private stopping = false;
  private fault: string | undefined;
  private faultedProcesses = new WeakSet<ProcessSession>();
  private launching: Promise<void> | undefined;
  private launchAbort: AbortController | undefined;
  private closing: Promise<void> | undefined;
  private initialized: NativeInitialization | undefined;
  private profile: NativeProfileWorkspace | undefined;
  private timeline = new NativeActionTimeline();
  private readonly actionability = new NativeActionability();

  protected readonly options: NativeOptions;
  protected readonly actions: readonly LocatorActionKind[];

  constructor(options: NativeOptions = {}) {
    this.actions = Object.freeze([...validateNativeOptions(options)]);
    this.options = Object.freeze({ ...options, actions: this.actions });
  }

  /** Override either factory to add a different transport or platform driver. */
  protected createTransport(port: number, context: RequestContext): Promise<NativeTransport> {
    return JsonRpcTcpTransport.connect(port, context, this.options.maxMessageBytes ?? DEFAULT_MESSAGE_LIMIT);
  }
  protected createDriver(transport: NativeTransport): NativeDriver { return new RpcNativeDriver(transport); }

  /** Override to launch an owned protocol sidecar while retaining engine supervision. */
  protected createProcess(launch: NativeProcessLaunch): Promise<ProcessSession> { return startProcess(launch.options); }

  /** A validated standard e2e engine handle, including subclassed driver hooks. */
  handle(): EngineHandle {
    const options = this.options;
    return defineEngine({
      name: 'native', version: (createRequire(import.meta.url)('../../package.json') as { version: string }).version, spiVersion: 1,
      platform: options.platform ?? 'desktop', workers: 1, actions: this.actions,
      validateApp(app: EngineAppDeclaration, { targetName }) {
        if (app.appPath === undefined || app.url !== undefined) throw new ConfigurationError('INVALID_CONFIG', `target "${targetName}" native app needs appPath and supports launchArguments; url is unsupported`);
      },
      init: (info) => this.init(info),
      startAttempt: (context) => this.startAttempt(context),
      endAttempt: (context) => this.stop(context),
      dispose: (context) => this.stop(context),
      settleAttempt: () => this.settle(),
      observe: (context, observeOptions) => this.snapshot(context, observeOptions?.pixels === true),
      locate: async (expression, context) => {
        const snapshot = await this.snapshot(context, false, false);
        if (snapshot.truncated) throw new EngineError('ENGINE_FAILURE', 'native tree is truncated; locator completeness cannot be established', { retryable: false });
        return resolveExpression(expression, [snapshot.root]);
      },
      perform: (ref, action, context) => this.perform(ref, action, context),
      session: { restart: (context) => this.launch(context) },
      ...(options.keyboard === false ? {} : { keyboard: {
        type: (text: string, typeOptions: { readonly replace: boolean }, context: OperationContext) => this.type(text, typeOptions.replace, context),
        press: (key: string, context: OperationContext) => this.press(key, context),
      } }),
      ...(options.screenshots === false ? {} : { artifacts: { screenshot: (label: string | undefined, context: OperationContext) => this.screenshot(label, context) } }),
      fixtures: { native: (context) => createNativeFixture(this, context) },
    });
  }

  init(info: EngineInitInfo): Promise<void> { this.info = info; return Promise.resolve(); }
  async startAttempt(context: EngineAttemptContext): Promise<void> {
    if (this.process !== undefined || this.launching !== undefined || this.closing !== undefined || this.profile !== undefined) throw new EngineError('INVALID_STATE', 'native app from a previous attempt is still running or closing', { retryable: false });
    this.attempt = context;
    this.rootId = undefined;
    this.screenshotCounter = 0;
    this.fault = undefined;
    this.faultedProcesses = new WeakSet<ProcessSession>();
    this.timeline = new NativeActionTimeline();
    if (this.options.isolateProfile === true) {
      const profile = await NativeProfileWorkspace.create();
      if (context.signal.aborted) { await profile.dispose(); throw cancelled(); }
      this.profile = profile;
    }
  }
  settle(): Promise<void> {
    if (this.fault !== undefined) { const message = this.fault; this.fault = undefined; return Promise.reject(new EngineError('ENGINE_FAILURE', message, { retryable: false })); }
    return Promise.resolve();
  }

  launch(context: OperationContext): Promise<void> {
    if (this.launching !== undefined || this.closing !== undefined) return Promise.reject(new EngineError('INVALID_STATE', 'native launch or cleanup is already in progress', { retryable: false }));
    const controller = new AbortController();
    this.launchAbort = controller;
    const work = this.timeline.record('restart', undefined, () => this.launchInternal({ ...context, signal: AbortSignal.any([context.signal, controller.signal]) }));
    const settled = work.finally(() => {
      if (this.launching === settled) { this.launching = undefined; this.launchAbort = undefined; }
    });
    this.launching = settled;
    return settled;
  }

  private async launchInternal(context: OperationContext): Promise<void> {
    if (context.signal.aborted) throw cancelled();
    const deadline = Date.now() + Math.min(this.options.launchTimeout ?? 30_000, context.timeoutMs);
    await this.stopInternal({ signal: context.signal, timeoutMs: Math.min(2000, context.timeoutMs) });
    const info = this.info;
    const attempt = this.attempt;
    if (info === undefined || attempt === undefined || info.app.appPath === undefined) throw new EngineError('INVALID_STATE', 'native launch requires an active attempt and appPath', { retryable: false });
    if (context.signal.aborted) throw cancelled();
    const remaining = (): RequestContext => ({ signal: context.signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    const token = randomBytes(32).toString('hex');
    this.stopping = false;
    try {
      const child = await this.createProcess({ options: {
        executable: path.resolve(info.projectRoot, info.app.appPath),
        args: info.app.launchArguments ?? [],
        cwd: path.resolve(info.projectRoot, this.options.cwd ?? '.'),
        inheritEnv: false,
        env: { ...info.env, ...this.profile?.env, E2E_NATIVE_TOKEN: token, E2E_NATIVE_PORT: '0' },
        signal: attempt.signal,
        maxOutputBytes: 1024 * 1024,
        killGraceMs: 200,
        drainTimeoutMs: 1000,
      }, context: remaining() });
      this.process = child;
      // Own a late factory result before observing cancellation, so cleanup
      // still drains it and stops its entire process tree.
      if (context.signal.aborted) throw cancelled();
      if (Date.now() >= deadline) throw new EngineError('OPERATION_TIMEOUT', 'native process acquisition exceeded its operation budget', { retryable: false });
      void child.result.then((result) => {
        // A crash may finish draining after restart has already requested stop.
        // Supervised stops retain their own status even when Windows taskkill
        // supplies a nonzero exit code; that is not a second application crash.
        const crashed = (result.status === 'exited' && result.exitCode !== null && result.exitCode !== 0) || result.status === 'signaled';
        if (crashed || (!this.stopping && this.process === child)) this.markFault(child, `native application exited unexpectedly (status ${result.status}, exit code ${result.exitCode}, signal ${result.signal})`);
      });
      const port = await this.readiness(child, token, remaining());
      const transport = await this.createTransport(port, remaining());
      try { this.driver = this.createDriver(transport); }
      catch (error) {
        try { transport.close(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Native driver construction and transport cleanup failed', { cause: cleanup }); }
        throw error;
      }
      this.disconnectSubscription = this.driver.onDisconnect(() => { if (!this.stopping) this.markFault(child, 'native bridge disconnected unexpectedly; application exit has not been established'); });
      const initialized = await this.driver.initialize(token, remaining());
      if (this.actions.some((kind) => !initialized.actions.includes(kind)) || (this.options.keyboard !== false && !initialized.keyboard) || (this.options.screenshots !== false && !initialized.screenshots)) throw new EngineError('UNSUPPORTED_CAPABILITY', 'native helper does not support the configured capabilities', { retryable: false });
      attempt.environment({ nativeHelper: `${initialized.name} ${initialized.version}` });
      this.initialized = initialized;
    } catch (error) {
      try { await this.stopInternal({ signal: new AbortController().signal, timeoutMs: 2000 }); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Native launch and cleanup failed', { cause: cleanup }); }
      throw error;
    }
  }

  stop(context: EngineCleanupContext): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.launchAbort?.abort();
    const pending = this.launching;
    const work = (async () => {
      await pending?.catch(() => { /* launch cleans up its own partial acquisition */ });
      const failures: unknown[] = [];
      try { await this.stopInternal(context); } catch (error) { failures.push(error); }
      const profile = this.profile;
      try {
        await profile?.dispose();
        if (this.profile === profile) this.profile = undefined;
      } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new EngineError('ENGINE_FAILURE', 'native process and profile cleanup failed', { retryable: false, cause: new AggregateError(failures) });
    })();
    const settled = work.finally(() => { if (this.closing === settled) this.closing = undefined; });
    this.closing = settled;
    return settled;
  }

  private async stopInternal(context: EngineCleanupContext): Promise<void> {
    this.stopping = true;
    const driver = this.driver;
    const child = this.process;
    this.driver = undefined;
    this.initialized = undefined;
    this.process = undefined;
    const failures: unknown[] = [];
    const diagnostics: string[] = [];
    const failed = (stage: string, cause: unknown) => {
      failures.push(cause);
      diagnostics.push(`${stage}:${cleanupCodes(cause)}`);
    };
    for (const release of [this.unsubscribe, this.disconnectSubscription]) {
      try { release?.(); } catch (cause) { failed('release', cause); }
    }
    this.unsubscribe = undefined;
    this.disconnectSubscription = undefined;
    if (driver !== undefined) {
      if (!context.signal.aborted) {
        try { await driver.shutdown({ signal: context.signal, timeoutMs: Math.min(200, context.timeoutMs) }); } catch { /* Process supervision supplies the final stop. */ }
      }
      try { driver.close(); } catch (cause) { failed('driver-close', cause); }
    }
    if (child !== undefined) {
      try {
        const result = await child.stop();
        if (result.ioError !== undefined) failed('process-io', result.ioError);
      } catch (cause) { failed('process-stop', cause); }
    }
    if (failures.length > 0) throw new EngineError('ENGINE_FAILURE', `native application cleanup failed (${diagnostics.join(', ')})`, { retryable: false, cause: new AggregateError(failures) });
  }

  async snapshot(context: OperationContext, pixels: boolean, observed = true): Promise<EngineSnapshot> {
    const wantsPixels = pixels && this.options.screenshots !== false;
    const snapshot = await this.connection().snapshot(this.budget(context), wantsPixels, observed);
    if (this.initialized?.windows !== true && this.rootId !== undefined && snapshot.root.ref.id !== this.rootId) throw new EngineError('ENGINE_FAILURE', 'native helper changed the stable root id', { retryable: false });
    this.rootId = snapshot.root.ref.id;
    return snapshot;
  }

  async perform(ref: NodeRef, action: LocatorAction, context: OperationContext): Promise<void> {
    if (!this.actions.includes(action.kind)) throw new EngineError('UNSUPPORTED_CAPABILITY', `native action ${action.kind} is not declared`, { retryable: false });
    if ('modifiers' in action && action.modifiers !== undefined) throw new EngineError('UNSUPPORTED_CAPABILITY', 'native bridge does not declare click modifiers', { retryable: false });
    await this.timeline.record('perform', action.kind, async () => {
      const driver = this.connection();
      const budget = this.budget(context);
      const ready = this.initialized?.actionability === true ? await this.actionability.wait(driver, ref, action, budget) : budget;
      // Preflight is read-only. The mutation is sent once even if its outcome is uncertain.
      await driver.perform(ref, action, ready);
    });
  }
  async type(text: string, replace: boolean, context: OperationContext): Promise<void> { await this.timeline.record('keyboard.type', undefined, () => this.connection().type(text, replace, this.budget(context))); }
  async press(key: string, context: OperationContext): Promise<void> { await this.timeline.record('keyboard.press', undefined, () => this.connection().press(key, this.budget(context))); }
  get profileDirectory(): string | undefined { return this.profile?.directory; }
  async windows(context: OperationContext): Promise<readonly NativeWindow[]> {
    if (this.initialized?.windows !== true) throw new EngineError('UNSUPPORTED_CAPABILITY', 'native helper does not declare owned-window enumeration', { retryable: false });
    return this.connection().windows(this.budget(context));
  }
  async activateWindow(id: string, context: OperationContext): Promise<void> {
    if (this.initialized?.windows !== true) throw new EngineError('UNSUPPORTED_CAPABILITY', 'native helper does not declare owned-window activation', { retryable: false });
    await this.timeline.record('window.activate', undefined, async () => {
      try { await this.connection().activateWindow(id, this.budget(context)); }
      finally { this.rootId = undefined; }
    });
  }
  async writeTimeline(): Promise<string> {
    if (this.attempt === undefined) throw new EngineError('INVALID_STATE', 'no native attempt', { retryable: false });
    return this.timeline.write(this.attempt.artifactsDir);
  }
  async screenshot(_label: string | undefined, context: OperationContext): Promise<string> {
    const attempt = this.attempt;
    if (attempt === undefined) throw new EngineError('INVALID_STATE', 'no native attempt', { retryable: false });
    const shot = await this.connection().screenshot(this.budget(context));
    const relative = `screenshots/native-${++this.screenshotCounter}.png`;
    await mkdir(path.join(attempt.artifactsDir, 'screenshots'), { recursive: true });
    await writeFile(path.join(attempt.artifactsDir, relative), shot.pixels.data, { flag: 'wx' });
    return relative;
  }

  private connection(): NativeDriver {
    if (this.driver === undefined) throw new EngineError('INVALID_STATE', 'native app is not open', { retryable: false });
    return this.driver;
  }
  private markFault(child: ProcessSession, message: string): void {
    if (this.faultedProcesses.has(child) && !message.includes('exited unexpectedly')) return;
    this.faultedProcesses.add(child);
    this.fault = message;
  }
  private budget(context: OperationContext): RequestContext { return { signal: context.signal, timeoutMs: Math.min(this.options.requestTimeout ?? 10_000, context.timeoutMs) }; }

  private readiness(child: ProcessSession, token: string, context: RequestContext): Promise<number> {
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => finish(new EngineError('OPERATION_TIMEOUT', 'native application did not announce bridge readiness', { retryable: false })), context.timeoutMs);
      const abort = () => finish(cancelled());
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abort);
        if (ready) return;
        ready = true;
        if (error !== undefined) reject(error);
        else resolve(port!);
      };
      const stdout = new OutputLineReader((line) => {
          if (line.startsWith('E2E_NATIVE_READY ')) {
            if (ready) return;
            try {
              const value: unknown = JSON.parse(line.slice('E2E_NATIVE_READY '.length));
              if (!isRecord(value) || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) throw new Error('invalid port');
              finish(undefined, Number(value.port));
            } catch { finish(new EngineError('ENGINE_FAILURE', 'native readiness announcement is invalid', { retryable: false })); }
          } else this.attempt?.appLog({ source: 'console', level: 'info', text: line.length > 4096 ? 'native output line omitted because it exceeds the size limit' : line.split(token).join('[native-token]') });
      }, () => { if (!ready) finish(new EngineError('ENGINE_FAILURE', 'native readiness line exceeded limit', { retryable: false })); });
      const stderr = new OutputLineReader((line) => {
        this.attempt?.appLog({ source: 'error', level: 'warning', text: line.length > 4096 ? 'native output line omitted because it exceeds the size limit' : line.split(token).join('[native-token]') });
      }, () => this.attempt?.appLog({ source: 'system', level: 'warning', text: 'native output line omitted because it exceeds the size limit' }));
      this.unsubscribe = child.onOutput(({ stream, bytes }) => {
        if (stream === 'stdout') stdout.write(bytes);
        else stderr.write(bytes);
      });
      context.signal.addEventListener('abort', abort, { once: true });
      stdout.write(child.stdout.bytes);
      stderr.write(child.stderr.bytes);
      if (context.signal.aborted) abort();
      void child.result.then(() => { stdout.end(); stderr.end(); finish(new EngineError('ENGINE_FAILURE', 'native application exited before bridge readiness', { retryable: false })); });
    });
  }
}
