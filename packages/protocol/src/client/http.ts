import { HttpResponse } from '../model/response.ts';
import { ProtocolError, type HttpClientOptions, type HttpRequestOptions } from '../model/types.ts';
import { FetchHttpTransport, HttpTransport } from '../transport/http.ts';
import { requestJson } from './json.ts';

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ProtocolError('INVALID_ARGUMENT', `${name} must be a positive safe integer`);
  if (name === 'timeoutMs' && value > 2_147_483_647) throw new ProtocolError('INVALID_ARGUMENT', 'timeoutMs exceeds the supported timer duration');
  return value;
}

function httpUrl(value: string, base?: URL): URL {
  let url: URL;
  try { url = new URL(value, base); }
  catch { throw new ProtocolError('INVALID_ARGUMENT', 'Invalid HTTP URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new ProtocolError('INVALID_ARGUMENT', 'Only HTTP(S) URLs without embedded credentials are supported');
  }
  return url;
}

/** Validates headers without retaining content-bearing host parser errors. */
function requestHeaders(defaults?: HeadersInit, additions?: Readonly<Record<string, string>>): Headers {
  try {
    const headers = new Headers(defaults);
    for (const [name, value] of Object.entries(additions ?? {})) headers.set(name, value);
    return headers;
  } catch { throw new ProtocolError('INVALID_ARGUMENT', 'Invalid HTTP headers'); }
}

/** Common protocol-client operations; request policy belongs to the subclass. */
export abstract class ProtocolClient {
  abstract request(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  get(path: string, options?: Omit<HttpRequestOptions, 'method' | 'body' | 'json'>): Promise<HttpResponse> { return this.request(path, { ...options, method: 'GET' }); }
  post(path: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<HttpResponse> { return this.request(path, { ...options, method: 'POST' }); }
  put(path: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<HttpResponse> { return this.request(path, { ...options, method: 'PUT' }); }
  delete(path: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<HttpResponse> { return this.request(path, { ...options, method: 'DELETE' }); }
}

/** Shared HTTP URL, credential, timeout and serialization policy for transports. */
export class HttpProtocolClient extends ProtocolClient {
  readonly #base: URL;
  readonly #timeout: number;
  readonly #limit: number;
  readonly #headers: Headers;
  readonly #allowCrossOrigin: boolean;
  readonly #transport: HttpTransport;
  constructor(options: HttpClientOptions, transport: HttpTransport) {
    super();
    this.#base = httpUrl(options.baseUrl);
    this.#timeout = positiveInteger(options.timeoutMs ?? 30_000, 'timeoutMs');
    this.#limit = positiveInteger(options.maxResponseBytes ?? 8 * 1024 * 1024, 'maxResponseBytes');
    this.#headers = requestHeaders(options.headers);
    this.#allowCrossOrigin = options.allowCrossOrigin === true;
    this.#transport = transport;
  }
  async request(path: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const url = httpUrl(path, this.#base);
    if (!this.#allowCrossOrigin && url.origin !== this.#base.origin) throw new ProtocolError('INVALID_ARGUMENT', 'Cross-origin HTTP requests require allowCrossOrigin');
    const timeoutMs = positiveInteger(options.timeoutMs ?? this.#timeout, 'timeoutMs');
    const maxResponseBytes = positiveInteger(options.maxResponseBytes ?? this.#limit, 'maxResponseBytes');
    if (options.body !== undefined && options.json !== undefined) throw new ProtocolError('INVALID_ARGUMENT', 'Use body or json, not both');
    const headers = requestHeaders(this.#headers, options.headers);
    let body: string | Uint8Array | undefined = options.body;
    if (options.json !== undefined) {
      try { body = requestJson(options.json); }
      catch { throw new ProtocolError('INVALID_ARGUMENT', 'Request JSON cannot be serialized'); }
      if (body === undefined) throw new ProtocolError('INVALID_ARGUMENT', 'Request JSON cannot be serialized');
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { const error = new ProtocolError('TIMEOUT', `HTTP request exceeded ${timeoutMs} ms`); controller.abort(error); reject(error); }, timeoutMs);
      abort = () => { const error = new ProtocolError('ABORTED', 'HTTP request was aborted'); controller.abort(error); reject(error); };
      options.signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      if (options.signal?.aborted === true) throw new ProtocolError('ABORTED', 'HTTP request was aborted');
      return await Promise.race([this.#transport.send(url, { method: options.method ?? 'GET', headers, ...(body === undefined ? {} : { body }), signal: controller.signal, maxResponseBytes }), interrupted]);
    } catch (cause) {
      if (cause instanceof ProtocolError) throw cause;
      if (controller.signal.reason instanceof ProtocolError) throw controller.signal.reason;
      // Transport errors can contain request URLs, credentials, or response data.
      throw new ProtocolError('NETWORK_ERROR', 'HTTP request failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort !== undefined) options.signal?.removeEventListener('abort', abort);
    }
  }
}

/** Default client using Node's built-in fetch. */
export class FetchHttpClient extends HttpProtocolClient {
  constructor(options: HttpClientOptions) { super(options, new FetchHttpTransport()); }
}
export type HttpClient = ProtocolClient;
export function createHttpClient(options: HttpClientOptions): FetchHttpClient { return new FetchHttpClient(options); }
