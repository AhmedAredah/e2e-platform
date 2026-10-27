import { setTimeout as delay } from 'node:timers/promises';
import { EngineError, type LocatorAction, type NodeRef } from '@e2e-platform/core/engine';
import type { NativeDriver } from '../driver/native-driver.ts';
import type { RequestContext } from '../transport/native-transport.ts';
import { cancelled } from '../transport/json-rpc-tcp.ts';

/** Polls a declared read-only preflight; a mutating call is never retried here. */
export class NativeActionability {
  constructor(private readonly intervalMs = 25) {}

  async wait(driver: NativeDriver, ref: NodeRef, action: LocatorAction, context: RequestContext): Promise<RequestContext> {
    const deadline = Date.now() + context.timeoutMs;
    for (;;) {
      if (context.signal.aborted) throw cancelled();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw notReady();
      try {
        await driver.actionability(ref, action, { signal: context.signal, timeoutMs: remaining });
        if (context.signal.aborted) throw cancelled();
        const after = deadline - Date.now();
        if (after <= 0) throw notReady();
        return { signal: context.signal, timeoutMs: after };
      } catch (error) {
        // This error is safe to poll only because actionability MUST be read-only.
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'NOT_ACTIONABLE') throw error;
        const after = deadline - Date.now();
        if (after <= 0) throw notReady();
        try { await delay(Math.min(this.intervalMs, after), undefined, { signal: context.signal }); }
        catch { throw cancelled(); }
      }
    }
  }
}

function notReady(): EngineError {
  return new EngineError('NOT_ACTIONABLE', 'native target did not become actionable within the operation budget', { retryable: false });
}
