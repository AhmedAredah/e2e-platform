/**
 * Native dialog routing: which handler answers, how registrations come and
 * go, and how a failure on the unawaited dialog path reaches the next step.
 */

import type { Dialog as PwDialog } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { DialogRouter } from '../../src/dialogs.ts';
import { ErrorLatch } from '../../src/support.ts';

function fakeDialog(text = 'are you sure?') {
  const accept = vi.fn(async (_text?: string) => undefined);
  const dismiss = vi.fn(async () => undefined);
  const dialog = { type: () => 'confirm', message: () => text, accept, dismiss } as unknown as PwDialog;
  return { dialog, accept, dismiss };
}

describe('DialogRouter', () => {
  it('routes to the newest handler and falls back once it unsubscribes', async () => {
    const router = new DialogRouter();
    const first = vi.fn();
    const second = vi.fn();
    router.add(first);
    const unsubscribe = router.add(second);

    await router.dispatch(fakeDialog().dialog);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unsubscribe();
    await router.dispatch(fakeDialog().dialog);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('tracks registrations by identity: the same handler twice, unsubscribed once, stays', async () => {
    const router = new DialogRouter();
    const handler = vi.fn((dialog: { accept(): Promise<void> }) => dialog.accept());
    const unsubscribeFirst = router.add(handler);
    router.add(handler);
    unsubscribeFirst();
    unsubscribeFirst();

    const { dialog } = fakeDialog();
    await router.dispatch(dialog);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => router.throwPending()).not.toThrow();
  });

  it('applies the accept and dismiss shorthands and passes the message through', async () => {
    const router = new DialogRouter();
    router.add('accept');
    const accepted = fakeDialog();
    await router.dispatch(accepted.dialog);
    expect(accepted.accept).toHaveBeenCalledTimes(1);

    router.add('dismiss');
    const dismissed = fakeDialog();
    await router.dispatch(dismissed.dialog);
    expect(dismissed.dismiss).toHaveBeenCalledTimes(1);

    const seen: string[] = [];
    router.add((dialog) => {
      seen.push(dialog.message);
      return dialog.accept('yes');
    });
    const custom = fakeDialog('name?');
    await router.dispatch(custom.dialog);
    expect(seen).toEqual(['name?']);
    expect(custom.accept).toHaveBeenCalledWith('yes');
  });

  it('dismisses a dialog its handler left undecided and latches INVALID_STATE naming the handler', async () => {
    const router = new DialogRouter();
    router.add(() => {
      // Looked, decided nothing: the page would stay blocked behind the dialog.
    });
    const { dialog, dismiss } = fakeDialog('are you sure?');
    await router.dispatch(dialog);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(() => router.throwPending()).toThrowError(
      expect.objectContaining({
        code: 'INVALID_STATE',
        message: expect.stringContaining('returned without calling accept or dismiss'),
      }),
    );
  });

  it('dismisses an unhandled dialog and latches INVALID_STATE, thrown exactly once', async () => {
    const router = new DialogRouter();
    const { dialog, dismiss } = fakeDialog('unexpected');
    await router.dispatch(dialog);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(() => router.throwPending()).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE', message: expect.stringContaining('unexpected') }),
    );
    expect(() => router.throwPending()).not.toThrow();
  });

  it('latches a failing handler as ENGINE_FAILURE, thrown once', async () => {
    const router = new DialogRouter();
    router.add(() => {
      throw new Error('handler exploded');
    });
    await router.dispatch(fakeDialog().dialog);
    expect(() => router.throwPending()).toThrowError(
      expect.objectContaining({ code: 'ENGINE_FAILURE', message: expect.stringContaining('handler exploded') }),
    );

    expect(() => router.throwPending()).not.toThrow();
  });

  it('shares one latch with its owner, so either side observes the failure', async () => {
    const latch = new ErrorLatch();
    const router = new DialogRouter(latch);
    await router.dispatch(fakeDialog().dialog);
    expect(() => latch.throwPending()).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect(() => router.throwPending()).not.toThrow();
  });
});

describe('ErrorLatch', () => {
  it('keeps the first error until it is thrown, then forgets it', () => {
    const latch = new ErrorLatch();
    const first = new Error('first');
    latch.latch(first);
    latch.latch(new Error('second'));
    expect(() => latch.throwPending()).toThrow(first);
    expect(() => latch.throwPending()).not.toThrow();
  });

  it('settles a started dialog handler and reports its late failure without another step', async () => {
    const latch = new ErrorLatch();
    const router = new DialogRouter(latch);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    router.add(async () => { await paused; throw new Error('final dialog handler failed'); });
    const callback = router.dispatch(fakeDialog().dialog);
    const settling = latch.settle({ timeoutMs: 1000, signal: new AbortController().signal });
    const rejected = expect(settling).rejects.toMatchObject({ code: 'ENGINE_FAILURE', message: expect.stringContaining('final dialog handler failed') });
    release();
    await rejected;
    await callback;
    await expect(latch.settle({ timeoutMs: 1000, signal: new AbortController().signal })).resolves.toBeUndefined();
  });

  it('uses one deadline when another callback begins during settlement', async () => {
    vi.useFakeTimers();
    const latch = new ErrorLatch();
    let finish!: () => void;
    try {
      void latch.track(new Promise<void>((resolve) => {
        setTimeout(() => {
          void latch.track(new Promise<void>((done) => { finish = done; }));
          resolve();
        }, 80);
      }));
      const settling = latch.settle({ timeoutMs: 100, signal: new AbortController().signal });
      const rejected = expect(settling).rejects.toMatchObject({ code: 'CLEANUP_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      finish();
      await latch.settle({ timeoutMs: 100, signal: new AbortController().signal });
    } finally { vi.useRealTimers(); }
  });

  it('abandons settlement on cancellation without consuming an error that arrives later', async () => {
    const latch = new ErrorLatch();
    let reject!: (cause: Error) => void;
    const callback = latch.track(new Promise<void>((_resolve, fail) => { reject = fail; }));
    const controller = new AbortController();
    const settling = latch.settle({ timeoutMs: 1000, signal: controller.signal });
    const cancelled = expect(settling).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await cancelled;
    reject(new Error('late callback fault'));
    await callback;
    await expect(latch.settle({ timeoutMs: 1000, signal: new AbortController().signal })).rejects.toThrow('late callback fault');
    expect(() => latch.throwPending()).not.toThrow();
  });
});
