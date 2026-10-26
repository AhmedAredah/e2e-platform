export type OAuthErrorCode =
  /** No stored credentials for the provider. */
  | 'NOT_LOGGED_IN'
  /** The refresh token was rejected; the user signs in again. */
  | 'LOGIN_REQUIRED'
  /** The authorization server or the vendor API answered with an error during a flow. */
  | 'FLOW_FAILED'
  /** The user or the caller cancelled the flow. */
  | 'CANCELLED'
  /** The flow ran out of time waiting for the user. */
  | 'TIMEOUT'
  /** The flow needs an option the caller did not give (a client id, a CLI). */
  | 'MISCONFIGURED';

export class OAuthError extends Error {
  override readonly name = 'OAuthError';
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(sanitizeOAuthDiagnostic(message), options);
  }
}

/** Removes known grant values before bounding and flattening untrusted diagnostic text. */
export function sanitizeOAuthDiagnostic(value: string, secrets: readonly string[] = []): string {
  let safe = value;
  const variants = secrets.filter(Boolean).flatMap((secret) => [secret, encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString().slice(6), JSON.stringify(secret).slice(1, -1)]);
  for (const secret of [...new Set(variants)].toSorted((a, b) => b.length - a.length)) safe = safe.split(secret).join('<redacted>');
  // oxlint-disable-next-line no-control-regex -- remove terminal and line controls at the diagnostic boundary
  return safe.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 512);
}

/** Reads a small OAuth response without buffering an unbounded server body. */
export async function readOAuthBody(response: Response, signal?: AbortSignal): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new OAuthError('CANCELLED', 'the OAuth operation was cancelled');
    for (;;) {
      const part = await reader.read();
      if (signal?.aborted) throw new OAuthError('CANCELLED', 'the OAuth operation was cancelled');
      if (part.done) return Buffer.concat(chunks, length).toString('utf8');
      length += part.value.byteLength;
      if (length > 65_536) {
        void reader.cancel().catch(() => {});
        throw new OAuthError('FLOW_FAILED', 'OAuth response exceeded the 64 KiB limit');
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Reads an error body without disclosing grant values or unlimited provider text. */
export async function describeResponse(response: Response, secrets: readonly string[] = [], signal?: AbortSignal): Promise<string> {
  const text = await readOAuthBody(response, signal).catch(() => '');
  if (text === '') return sanitizeOAuthDiagnostic(`${response.status} ${response.statusText}`, secrets);
  try {
    const json = JSON.parse(text) as { error?: unknown; error_description?: unknown; message?: unknown };
    const error = json.error;
    const detail =
      typeof json.error_description === 'string'
        ? json.error_description
        : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : typeof json.message === 'string'
            ? json.message
            : typeof error === 'string'
              ? error
              : undefined;
    return sanitizeOAuthDiagnostic(`${response.status}: ${detail ?? text}`, secrets);
  } catch {
    return sanitizeOAuthDiagnostic(`${response.status}: ${text}`, secrets);
  }
}
