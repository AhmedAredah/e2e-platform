/** Budget and cancellation apply both while a request queues and while it is in flight. */
export interface RequestContext { readonly signal: AbortSignal; readonly timeoutMs: number }

/**
 * Subclass to support another authenticated transport. An implementation must
 * serialize mutations and report uncertain outcomes rather than retrying them.
 */
export abstract class NativeTransport {
  abstract request(method: string, params: unknown, context: RequestContext, mutates?: boolean): Promise<unknown>;
  abstract close(): void;
  /** Reports unexpected disconnects or protocol faults, including while idle; intentional close is quiet. */
  onDisconnect(_listener: () => void): () => void { return () => {}; }
}
