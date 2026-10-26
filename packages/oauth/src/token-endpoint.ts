/**
 * The HTTP an OAuth flow is made of: form-encoded POSTs to a token endpoint
 * and the token response every vendor answers with. Timing values from the
 * wire are coerced defensively: a `NaN` expiry written to disk would poison
 * the credentials file.
 */

import { OAuthError, describeResponse, readOAuthBody, sanitizeOAuthDiagnostic, type OAuthErrorCode } from './errors.ts';
import { OAuthOperation, OAUTH_REQUEST_TIMEOUT_MS } from './operation.ts';

export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in?: number;
}

export async function postForm(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** JSON parser errors never quote a server's possibly credential-bearing response. */
export async function readOAuthJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const body = await readOAuthBody(response, signal);
  try { return JSON.parse(body); }
  catch { throw new OAuthError('FLOW_FAILED', 'the OAuth response is not valid JSON'); }
}

/**
 * Posts a grant and returns the tokens. A 400 or 401 means the grant itself
 * was rejected and maps to `rejected` (LOGIN_REQUIRED for a refresh, FLOW_FAILED
 * for a code exchange); anything else not OK is FLOW_FAILED.
 */
export async function requestTokens(
  vendor: string,
  url: string,
  params: Record<string, string>,
  rejected: OAuthErrorCode = 'FLOW_FAILED',
  signal?: AbortSignal,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<TokenResponse> {
  return new OAuthOperation(signal, timeoutMs).run(async (requestSignal) => {
    try {
      const response = await postForm(url, params, requestSignal);
      if (!response.ok) {
        const code = response.status === 400 || response.status === 401 ? rejected : 'FLOW_FAILED';
        const suffix = code === 'LOGIN_REQUIRED' ? '; sign in again' : '';
        throw new OAuthError(code, `${vendor} token request failed (${await describeResponse(response, Object.values(params), requestSignal)})${suffix}`);
      }
      const tokens = await readOAuthJson(response, requestSignal) as Partial<TokenResponse> | null;
      if (tokens === null || typeof tokens.access_token !== 'string' || tokens.access_token === '') {
        throw new OAuthError('FLOW_FAILED', `the ${vendor} token response is missing access_token`);
      }
      return tokens as TokenResponse;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError('FLOW_FAILED', `${vendor} token request failed: ${sanitizeOAuthDiagnostic(error instanceof Error ? error.message : String(error), Object.values(params))}`);
    }
  });
}

/** A seconds value from the server, or the default when it is missing or not a positive finite number. */
export function positiveSeconds(value: unknown, fallback: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

/** When a token expires, from `expires_in`; one hour when the server names nothing usable. */
export function expiryFrom(expiresIn: unknown, now: number = Date.now()): number {
  const expiry = now + positiveSeconds(expiresIn, 3600) * 1000;
  return Number.isFinite(expiry) ? expiry : now + 3600 * 1000;
}
