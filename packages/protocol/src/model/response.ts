import { ProtocolError, type ProtocolSchema } from './types.ts';

/** An immutable, bounded response. Failed HTTP status is still a response. */
export class HttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
  readonly #body: Uint8Array;

  constructor(response: Response, body: Uint8Array) {
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
    this.headers = Object.freeze(Object.fromEntries(response.headers));
    this.#body = new Uint8Array(body);
  }

  get ok(): boolean { return this.status >= 200 && this.status < 300; }
  get size(): number { return this.#body.byteLength; }
  bytes(): Uint8Array { return new Uint8Array(this.#body); }
  text(): string { return new TextDecoder().decode(this.#body); }
  json(): unknown {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.#body)) as unknown; }
    // Native parser errors quote response data, including credentials, in their message.
    catch { throw new ProtocolError('INVALID_JSON', 'HTTP response is not valid JSON'); }
  }
  expectStatus(expected: number | readonly number[]): this {
    const allowed = typeof expected === 'number' ? [expected] : expected;
    if (!allowed.includes(this.status)) {
      throw new ProtocolError('STATUS_MISMATCH', `Expected HTTP status ${allowed.join(' or ')}, received ${this.status}`);
    }
    return this;
  }
  async validate<T>(schema: ProtocolSchema<T>): Promise<T> {
    const data = this.json();
    let result: Awaited<ReturnType<ProtocolSchema<T>['~standard']['validate']>>;
    try { result = await schema['~standard'].validate(data); }
    catch { throw new ProtocolError('SCHEMA_MISMATCH', 'HTTP schema validation failed'); }
    if (result.issues !== undefined) {
      // Validation issues can echo credentials or an entire response body.
      throw new ProtocolError('SCHEMA_MISMATCH', `HTTP JSON failed schema validation (${result.issues.length} issues)`);
    }
    return result.value;
  }
}
