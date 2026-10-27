import { EngineError, type EngineSnapshot, type LocatorAction, type LocatorActionKind, type NodeRef, type ObservationPixels } from '@e2e-platform/core/engine';
import type { RequestContext } from '../transport/native-transport.ts';

export interface NativeInitialization {
  readonly protocolVersion: 1;
  readonly name: string;
  readonly version: string;
  readonly actions: readonly LocatorActionKind[];
  readonly keyboard: boolean;
  readonly screenshots: boolean;
  /** The helper can check readiness without dispatching input. */
  readonly actionability?: boolean;
  /** The helper can enumerate and activate windows owned by this application. */
  readonly windows?: boolean;
}

export interface NativeWindow {
  readonly id: string;
  readonly title: string;
  readonly visible: boolean;
  readonly active: boolean;
  readonly modal: boolean;
}

export interface NativeScreenshot {
  readonly pixels: ObservationPixels;
  readonly maskedRegionCount: number;
}

/**
 * Platform driver boundary. A custom driver may use Qt introspection or native
 * accessibility, but must keep secure data out of snapshots and pixels at source.
 */
export abstract class NativeDriver {
  abstract initialize(token: string, context: RequestContext): Promise<NativeInitialization>;
  abstract snapshot(context: RequestContext, pixels: boolean, observed?: boolean): Promise<EngineSnapshot>;
  abstract perform(ref: NodeRef, action: LocatorAction, context: RequestContext): Promise<void>;
  abstract type(text: string, replace: boolean, context: RequestContext): Promise<void>;
  abstract press(key: string, context: RequestContext): Promise<void>;
  abstract screenshot(context: RequestContext): Promise<NativeScreenshot>;
  abstract shutdown(context: RequestContext): Promise<void>;
  abstract close(): void;
  /** Optional read-only preflight. Never emulate this by dispatching the action. */
  actionability(_ref: NodeRef, _action: LocatorAction, _context: RequestContext): Promise<void> { return Promise.reject(unsupported('actionability')); }
  windows(_context: RequestContext): Promise<readonly NativeWindow[]> { return Promise.reject(unsupported('window enumeration')); }
  activateWindow(_id: string, _context: RequestContext): Promise<void> { return Promise.reject(unsupported('window activation')); }
  onDisconnect(_listener: () => void): () => void { return () => {}; }
}

function unsupported(capability: string): EngineError {
  return new EngineError('UNSUPPORTED_CAPABILITY', `native driver does not support ${capability}`, { retryable: false });
}
