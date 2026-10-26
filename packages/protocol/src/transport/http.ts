import { HttpResponse } from '../model/response.ts';
import { ProtocolError } from '../model/types.ts';

export interface HttpTransportRequest {
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string | Uint8Array;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

/** A subclass must honor cancellation and the decoded response byte limit. */
export abstract class HttpTransport {
  abstract send(url: URL, request: HttpTransportRequest): Promise<HttpResponse>;
}

async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  let finished = false;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) { finished = true; break; }
      size += next.value.byteLength;
      if (size > limit) throw new ProtocolError('RESPONSE_LIMIT', `HTTP response exceeds ${limit} bytes`);
      chunks.push(next.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}


/** Built-in fetch implementation; redirects never forward configured headers. */
export class FetchHttpTransport extends HttpTransport {
  async send(url: URL, request: HttpTransportRequest): Promise<HttpResponse> {
    const response = await fetch(url, {
      method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: typeof request.body === 'string' ? request.body : new Uint8Array(request.body) }),
      signal: request.signal, redirect: 'manual',
    });
    return new HttpResponse(response, await boundedBody(response, request.maxResponseBytes));
  }
}
