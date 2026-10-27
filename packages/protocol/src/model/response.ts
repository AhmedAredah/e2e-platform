import { ProtocolError, type ProtocolSchema } from './types.ts';
import { parseJson, type JsonReadOptions } from '@e2e-platform/checks';

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
  json(options: JsonReadOptions = {}): unknown {
    try { return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(this.#body), options); }
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
  async validate<T>(schema: ProtocolSchema<T>, options: JsonReadOptions = {}): Promise<T> {
    const data = this.json(options);
    let count: number | undefined;
    try {
      const result = await schema['~standard'].validate(data);
      if (result === null || typeof result !== 'object') throw new Error();
      const issues = result.issues;
      if (issues === undefined) {
        if (!Object.hasOwn(result, 'value')) throw new Error();
        return result.value;
      }
      if (!Array.isArray(issues)) throw new Error();
      count = issues.length;
    } catch { throw new ProtocolError('SCHEMA_MISMATCH', 'HTTP schema validation failed'); }
    throw new ProtocolError('SCHEMA_MISMATCH', `HTTP JSON failed schema validation (${count} issues)`);
  }
}
