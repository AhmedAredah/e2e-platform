import type { EngineSnapshot, LocatorAction, LocatorActionKind, NodeRef, ObservationPixels } from '@e2e-cpp/core/engine';
import type { RequestContext } from '../transport/native-transport.ts';

export interface NativeInitialization {
  readonly protocolVersion: 1;
  readonly name: string;
  readonly version: string;
  readonly actions: readonly LocatorActionKind[];
  readonly keyboard: boolean;
  readonly screenshots: boolean;
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
  onDisconnect(_listener: () => void): () => void { return () => {}; }
}
