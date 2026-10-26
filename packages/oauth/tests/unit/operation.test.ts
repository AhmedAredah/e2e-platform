import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthFetch, createCodexProvider, MemoryCredentialStore, requestTokens, rfc8628Flow, runDeviceFlow } from '../../src/index.ts';

afterEach(() => vi.restoreAllMocks());

describe('OAuth cancellation and deadlines', () => {
  it('cancels one caller while another completes the same built-in provider refresh', async () => {
    let release!: (response: Response) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    let refreshSignal: AbortSignal | undefined;
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      refreshSignal = init?.signal ?? undefined;
      began();
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    const upstream = vi.fn(async () => new Response('{}'));
    const store = new MemoryCredentialStore({ openai: { access: 'old', refresh: 'old-refresh', expires: 1 } });
    const oauth = createOAuthFetch(createCodexProvider(), { store, userAgent: 'test', fetch: upstream });
    const abort = new AbortController();
    const first = oauth('https://example.invalid/models', { signal: abort.signal });
    const second = oauth('https://example.invalid/models');
    await started;
    abort.abort(new Error('caller-supplied text'));
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(refreshSignal?.aborted).toBe(false);
    release(new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 3600 })));
    expect((await second).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(await store.get('openai')).toMatchObject({ access: 'fresh' });
  });

  it('bounds a stuck shared refresh and signals the underlying network operation', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const oauth = createOAuthFetch(createCodexProvider(), {
      store: new MemoryCredentialStore({ openai: { access: 'old', refresh: 'old-refresh', expires: 1 } }),
      userAgent: 'test', refreshTimeoutMs: 20,
    });
    await expect(oauth('https://example.invalid/models')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(signal?.aborted).toBe(true);
  });

  it('bounds token response-body reads and cancels their stream', async () => {
    let cancelled = false;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await expect(requestTokens('test', 'https://example.invalid/token', {}, 'FLOW_FAILED', undefined, 20)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(cancelled).toBe(true);
  });

  it('does not start a device request when already cancelled', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('must not fetch'); });
    await expect(rfc8628Flow({
      vendor: 'test', clientId: 'public', deviceCodeUrl: 'https://example.invalid/code', tokenUrl: 'https://example.invalid/token', request: {},
      callbacks: { onAuth() {}, onPrompt: async () => '', signal: AbortSignal.abort() },
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(network).not.toHaveBeenCalled();
  });

  it('propagates cancellation into an initial device request that is already waiting', async () => {
    let signal: AbortSignal | undefined;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      signal = init?.signal ?? undefined;
      began();
      return new Promise<Response>(() => {});
    });
    const controller = new AbortController();
    const pending = rfc8628Flow({
      vendor: 'test', clientId: 'public', deviceCodeUrl: 'https://example.invalid/code', tokenUrl: 'https://example.invalid/token', request: {},
      callbacks: { onAuth() {}, onPrompt: async () => '', signal: controller.signal },
    });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(signal?.aborted).toBe(true);
  });

  it('does not poll after sleeping to the device-code deadline', async () => {
    let now = 0;
    const poll = vi.fn(async () => ({ status: 'granted' as const, value: 'too-late' }));
    await expect(runDeviceFlow({
      start: async () => ({ deviceCode: 'd', userCode: 'u', verificationUri: 'https://example.invalid', expiresIn: 1, interval: 1 }),
      poll, callbacks: { onAuth() {}, onPrompt: async () => '' }, now: () => now,
      sleep: async (ms) => { now += ms; },
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(poll).not.toHaveBeenCalled();
  });

  it('expires an in-flight device poll, even when the transport ignores its signal', async () => {
    let signal: AbortSignal | undefined;
    await expect(runDeviceFlow({
      start: async () => ({ deviceCode: 'd', userCode: 'u', verificationUri: 'https://example.invalid', expiresIn: 0.02, interval: 1 }),
      poll: async (_authorization, active) => { signal = active; return new Promise(() => {}); },
      callbacks: { onAuth() {}, onPrompt: async () => '' }, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('OAuth diagnostics', () => {
  it('redacts reflected raw and encoded credentials before flattening and bounding diagnostics', async () => {
    const secret = 'fake refresh/value+with spaces';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error_description: `${secret}\n${encodeURIComponent(secret)}\u001b[31m\n${'detail '.repeat(200)}`,
    }), { status: 400 }));
    try {
      await requestTokens('test', 'https://example.invalid/token', { refresh_token: secret }, 'LOGIN_REQUIRED');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'LOGIN_REQUIRED' });
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain(encodeURIComponent(secret));
      expect(message).toContain('<redacted>');
      // oxlint-disable-next-line no-control-regex -- assert that diagnostic control characters were removed
      expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(message.length).toBeLessThanOrEqual(512);
    }
  });

  it('omits oversized response bodies and malformed token JSON rather than exposing partial secrets', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    network.mockResolvedValueOnce(new Response(`fake-token${'x'.repeat(70_000)}`, { status: 400 }));
    await expect(requestTokens('test', 'https://example.invalid/token', { refresh_token: 'fake-token' })).rejects.toMatchObject({ message: 'test token request failed (400)' });
    network.mockResolvedValueOnce(new Response('{"access_token":"fake-token"'));
    await expect(requestTokens('test', 'https://example.invalid/token', {})).rejects.toMatchObject({ message: 'the OAuth response is not valid JSON' });
  });
});
