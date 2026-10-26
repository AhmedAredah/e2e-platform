import { OAuthError } from './errors.ts';

/** The default bound for one OAuth network operation, including its response body. */
export const OAUTH_REQUEST_TIMEOUT_MS = 30_000;

/** Cancellation never includes arbitrary caller-supplied text in credential diagnostics. */
function cancellation(signal: AbortSignal): OAuthError {
  return signal.reason instanceof OAuthError && signal.reason.code === 'TIMEOUT'
    ? signal.reason
    : new OAuthError('CANCELLED', 'the OAuth operation was cancelled');
}

/** Stops one waiter without cancelling work shared with another caller. */
export function waitForOAuth<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(cancellation(signal!));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal?.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** Owns one bounded operation and propagates cancellation to cooperative transports. */
export class OAuthOperation {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onAbort: () => void;

  constructor(private readonly parent?: AbortSignal, timeoutMs = OAUTH_REQUEST_TIMEOUT_MS) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new OAuthError('MISCONFIGURED', 'OAuth timeoutMs must be a positive finite timer duration');
    }
    this.onAbort = () => this.controller.abort(cancellation(parent!));
    if (parent?.aborted) this.onAbort();
    else parent?.addEventListener('abort', this.onAbort, { once: true });
    this.timer = setTimeout(() => this.controller.abort(new OAuthError('TIMEOUT', 'the OAuth operation timed out')), timeoutMs);
  }

  /** Releases deadline resources even when a custom transport ignores cancellation. */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      if (this.controller.signal.aborted) throw cancellation(this.controller.signal);
      return await waitForOAuth(Promise.resolve().then(() => {
        if (this.controller.signal.aborted) throw cancellation(this.controller.signal);
        return work(this.controller.signal);
      }), this.controller.signal);
    } finally {
      clearTimeout(this.timer);
      this.parent?.removeEventListener('abort', this.onAbort);
    }
  }
}
