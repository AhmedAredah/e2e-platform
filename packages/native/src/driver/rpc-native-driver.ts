import { EngineError, LOCATOR_ACTION_KINDS, type EngineSnapshot, type LocatorAction, type LocatorActionKind, type NodeRef } from '@e2e-platform/core/engine';
import { isRecord } from '../transport/json-rpc-tcp.ts';
import type { NativeTransport, RequestContext } from '../transport/native-transport.ts';
import { NativeDriver, type NativeInitialization, type NativeScreenshot, type NativeWindow } from './native-driver.ts';
import { parseScreenshot, parseSnapshot } from './snapshot.ts';

/** Protocol-v1 driver. Subclass for additional typed, explicitly declared methods. */
export class RpcNativeDriver extends NativeDriver {
  constructor(protected readonly transport: NativeTransport) { super(); }

  async initialize(token: string, context: RequestContext): Promise<NativeInitialization> {
    const result = await this.transport.request('initialize', { protocolVersion: 1, token }, context);
    if (!isRecord(result) || result.protocolVersion !== 1 || typeof result.name !== 'string' || result.name.trim() === '' || result.name.length > 256 || typeof result.version !== 'string' || result.version.trim() === '' || result.version.length > 128 || !Array.isArray(result.actions) || result.actions.some((kind) => !LOCATOR_ACTION_KINDS.includes(kind as LocatorActionKind)) || typeof result.keyboard !== 'boolean' || typeof result.screenshots !== 'boolean') throw new EngineError('ENGINE_FAILURE', 'invalid native initialization response', { retryable: false });
    for (const capability of ['actionability', 'windows'] as const) if (result[capability] !== undefined && typeof result[capability] !== 'boolean') throw new EngineError('ENGINE_FAILURE', 'invalid optional native capability', { retryable: false });
    return { protocolVersion: 1, name: result.name, version: result.version, actions: result.actions as LocatorActionKind[], keyboard: result.keyboard, screenshots: result.screenshots,
      ...(typeof result.actionability === 'boolean' ? { actionability: result.actionability } : {}),
      ...(typeof result.windows === 'boolean' ? { windows: result.windows } : {}),
    };
  }
  async snapshot(context: RequestContext, pixels: boolean, observed = true): Promise<EngineSnapshot> {
    return parseSnapshot(await this.transport.request('snapshot', pixels ? { pixels: true } : {}, context), observed, pixels).snapshot;
  }
  async perform(ref: NodeRef, action: LocatorAction, context: RequestContext): Promise<void> { await this.mutate('perform', { ref, action }, context); }
  override async actionability(ref: NodeRef, action: LocatorAction, context: RequestContext): Promise<void> {
    const result = await this.transport.request('actionability', { ref, action }, context);
    if (result !== null) throw new EngineError('ENGINE_FAILURE', 'invalid native actionability response', { retryable: false });
  }
  override async windows(context: RequestContext): Promise<readonly NativeWindow[]> {
    const result = await this.transport.request('windows', {}, context);
    if (!Array.isArray(result) || result.length > 256) throw invalidWindows();
    const ids = new Set<string>();
    return result.map((item: unknown) => {
      if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 512 || item.id.includes('\0') || ids.has(item.id) || typeof item.title !== 'string' || item.title.length > 256 || item.title.includes('\0') || typeof item.visible !== 'boolean' || typeof item.active !== 'boolean' || typeof item.modal !== 'boolean' || Object.keys(item).some((key) => !['id', 'title', 'visible', 'active', 'modal'].includes(key))) throw invalidWindows();
      ids.add(item.id);
      return Object.freeze({ id: item.id, title: item.title, visible: item.visible, active: item.active, modal: item.modal });
    });
  }
  override async activateWindow(id: string, context: RequestContext): Promise<void> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 512 || id.includes('\0')) throw new EngineError('INVALID_STATE', 'native window id is invalid', { retryable: false });
    await this.mutate('window.activate', { id }, context);
  }
  async type(text: string, replace: boolean, context: RequestContext): Promise<void> { await this.mutate('keyboard.type', { text, replace }, context); }
  async press(key: string, context: RequestContext): Promise<void> { await this.mutate('keyboard.press', { key }, context); }
  async screenshot(context: RequestContext): Promise<NativeScreenshot> {
    const deadline = Date.now() + context.timeoutMs;
    const current = parseSnapshot(await this.transport.request('snapshot', {}, context), false, false);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new EngineError('OPERATION_TIMEOUT', 'native screenshot exceeded its operation budget', { retryable: false });
    return parseScreenshot(await this.transport.request('screenshot', {}, { signal: context.signal, timeoutMs: remaining }), current.secureCount);
  }
  async shutdown(context: RequestContext): Promise<void> { await this.mutate('shutdown', {}, context); }
  private async mutate(method: string, params: Record<string, unknown>, context: RequestContext): Promise<void> {
    const result = await this.transport.request(method, params, context, true);
    if (result !== null) throw new EngineError('ACTION_MAY_HAVE_COMMITTED', `invalid native ${method} response: expected null`, { retryable: false });
  }
  close(): void { this.transport.close(); }
  override onDisconnect(listener: () => void): () => void { return this.transport.onDisconnect(listener); }
}

function invalidWindows(): EngineError { return new EngineError('ENGINE_FAILURE', 'invalid native window enumeration response', { retryable: false }); }
