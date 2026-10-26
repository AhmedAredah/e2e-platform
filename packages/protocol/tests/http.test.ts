import { gzipSync } from 'node:zlib';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHttpClient, HttpProtocolClient, HttpResponse, HttpTransport, type HttpTransportRequest } from '../src/index.ts';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case '/echo': {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => { body += chunk; });
        request.on('end', () => {
          response.writeHead(201, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ method: request.method, body: JSON.parse(body) as unknown, auth: request.headers.authorization }));
        });
        break;
      }
      case '/gzip': {
        const body = gzipSync('x');
        response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(body.length) }); response.end(body); break;
      }
      case '/bad-json': response.end('{invalid'); break;
      case '/declared-large': response.writeHead(200, { 'content-length': '1000' }); response.end('x'.repeat(1000)); break;
      case '/stream-large': response.writeHead(200); response.write('x'.repeat(60)); response.end('y'.repeat(60)); break;
      case '/slow': {
        const timer = setTimeout(() => { response.end('late'); }, 1000);
        response.on('close', () => { clearTimeout(timer); });
        break;
      }
      case '/slow-body': {
        response.writeHead(200); response.write('first');
        const timer = setTimeout(() => { response.end('late'); }, 1000);
        response.on('close', () => { clearTimeout(timer); });
        break;
      }
      case '/redirect': response.writeHead(302, { location: '/target' }); response.end(); break;
      default: response.writeHead(404); response.end('missing');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => { server.close((error) => error === undefined ? resolve() : reject(error)); });
});

describe('bounded HTTP client', () => {
  test('sends structured JSON and validates independent status/schema', async () => {
    const client = createHttpClient({ baseUrl, headers: { authorization: 'test-credential' } });
    const response = await client.post('/echo', { json: { value: 'حلو 😀' } });
    response.expectStatus(201);
    expect(response.ok).toBe(true);
    const body = await response.validate({ '~standard': { validate: (value) => ({ value: value as { method: string; body: { value: string }; auth: string } }) } });
    expect(body).toEqual({ method: 'POST', body: { value: 'حلو 😀' }, auth: 'test-credential' });
    const copy = response.bytes();
    copy.fill(0);
    expect(response.text()).toContain('POST');
    expect(response.size).toBeGreaterThan(0);
  });
  test('copies Node Buffer input and every returned byte array', () => {
    const body = Buffer.from('{"value":42}');
    const response = new HttpResponse(new Response(), body);
    body.fill(0);
    expect(response.json()).toEqual({ value: 42 });
    response.bytes().fill(0);
    expect(response.json()).toEqual({ value: 42 });
  });
  test('HTTP failures are inspectable and status mismatch is explicit', async () => {
    const response = await createHttpClient({ baseUrl }).get('/missing');
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(() => response.expectStatus(200)).toThrow('received 404');
    expect(response.expectStatus([400, 404])).toBe(response);
  });
  test('rejects malformed response JSON and schema mismatch', async () => {
    const client = createHttpClient({ baseUrl });
    const malformed = await client.get('/bad-json');
    expect(() => malformed.json()).toThrow('not valid JSON');
    const response = await client.post('/echo', { json: {} });
    await expect(response.validate({ '~standard': { validate: async () => ({ issues: [{ message: 'sensitive contents' }] }) } })).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH', message: 'HTTP JSON failed schema validation (1 issues)' });
  });
  test.each(['/declared-large', '/stream-large'])('caps %s before unbounded buffering', async (path) => {
    await expect(createHttpClient({ baseUrl, maxResponseBytes: 100 }).get(path)).rejects.toMatchObject({ code: 'RESPONSE_LIMIT' });
  });
  test.each(['/slow', '/slow-body'])('timeout covers headers and streamed body: %s', async (path) => {
    await expect(createHttpClient({ baseUrl, timeoutMs: 30 }).get(path)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  test('supports caller abort including an already aborted signal', async () => {
    const controller = new AbortController();
    const pending = createHttpClient({ baseUrl }).get('/slow', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(createHttpClient({ baseUrl }).get('/slow', { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
  });
  test('does not follow redirects or leak defaults to another origin', async () => {
    const client = createHttpClient({ baseUrl, headers: { authorization: 'secret' } });
    expect((await client.get('/redirect')).status).toBe(302);
    await expect(client.get('https://example.invalid/')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  test('rejects invalid config and ambiguous request body', async () => {
    expect(() => createHttpClient({ baseUrl: 'file:///tmp/test' })).toThrow('Only HTTP(S)');
    expect(() => createHttpClient({ baseUrl, maxResponseBytes: 0 })).toThrow('positive safe integer');
    await expect(createHttpClient({ baseUrl }).post('/echo', { body: 'x', json: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  test('custom transport subclasses share HTTP serialization, status and schema policy', async () => {
    class FixtureTransport extends HttpTransport {
      effects = 0;
      async send(_url: URL, request: HttpTransportRequest): Promise<HttpResponse> {
        request.signal.throwIfAborted();
        if (request.method === 'POST') this.effects += 1;
        return new HttpResponse(new Response(null, { status: 202 }), new TextEncoder().encode(JSON.stringify({ effects: this.effects, received: request.body })));
      }
    }
    const transport = new FixtureTransport();
    const client = new HttpProtocolClient({ baseUrl }, transport);
    const response = await client.post('/effect', { json: { count: 1 } });
    response.expectStatus(202);
    expect(response.json()).toEqual({ effects: 1, received: '{"count":1}' });
    expect(transport.effects).toBe(1);
  });
});

test('counts decoded bytes even when compressed framing is larger than the body', async () => {
  const response = await createHttpClient({ baseUrl, maxResponseBytes: 1 }).get('/gzip');
  expect(response.text()).toBe('x');
});

test('request validation and transport failures do not expose payloads through Error causes', async () => {
  const marker = 'PRIVATE_HTTP_REQUEST_49275';
  class BrokenTransport extends HttpTransport {
    async send(): Promise<HttpResponse> { throw new Error(marker); }
  }
  const client = new HttpProtocolClient({ baseUrl }, new BrokenTransport());
  const cases = [
    () => createHttpClient({ baseUrl: marker }),
    () => createHttpClient({ baseUrl, headers: { authorization: `${marker}\nvalue` } }),
    () => client.get('/', { headers: { authorization: `${marker}\nvalue` } }),
    () => client.post('/', { json: { toJSON() { throw new Error(marker); } } }),
    () => client.get('/'),
  ];
  for (const run of cases) {
    let failure: unknown;
    try { await run(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(inspect(failure, { depth: 10 })).not.toContain(marker);
  }
});

test('a throwing schema cannot echo its input into a diagnostic', async () => {
  const marker = 'PRIVATE_SCHEMA_RESPONSE_73493';
  const response = new HttpResponse(new Response(), new TextEncoder().encode(JSON.stringify({ token: marker })));
  let failure: unknown;
  try {
    await response.validate({ '~standard': { validate(value) { throw new Error(JSON.stringify(value)); } } });
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'SCHEMA_MISMATCH' });
  expect(inspect(failure, { depth: 10 })).not.toContain(marker);
});
