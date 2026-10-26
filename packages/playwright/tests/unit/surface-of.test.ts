/**
 * `surfaceOf` hands agent-side code the live page and context behind a
 * `playwright()` handle, and nothing for any other engine. Without an
 * attempt there is nothing live, so both accessors refuse with INVALID_STATE.
 */

import { describe, expect, it, vi } from 'vitest';
import { EngineError, defineEngine } from '@e2e-cpp/core/engine';
import { playwright, surfaceOf } from '../../src/index.ts';
import { PlaywrightSurface } from '../../src/surface.ts';

describe('surfaceOf', () => {
  it('exposes the surface settlement hook through the public engine', async () => {
    const settling = vi.spyOn(PlaywrightSurface.prototype, 'settleAttempt').mockResolvedValue(undefined);
    try {
      const handle = playwright();
      const context = { timeoutMs: 50, signal: new AbortController().signal };
      await handle.settleAttempt!(context);
      expect(settling).toHaveBeenCalledExactlyOnceWith(context);
    } finally { settling.mockRestore(); }
  });
  it('returns a live surface for a playwright handle and undefined for a foreign one', () => {
    const handle = playwright();
    expect(surfaceOf(handle)).toBeDefined();
    const other = defineEngine({ name: 'other', version: '1', spiVersion: 1 });
    expect(surfaceOf(other)).toBeUndefined();
  });

  it('refuses the page and the context before an attempt is running', () => {
    const live = surfaceOf(playwright());
    expect(live).toBeDefined();
    for (const read of [() => live?.context(), () => live?.page()]) {
      try {
        read();
        throw new Error('expected INVALID_STATE');
      } catch (error) {
        expect(error).toBeInstanceOf(EngineError);
        expect((error as EngineError).code).toBe('INVALID_STATE');
      }
    }
  });
});
