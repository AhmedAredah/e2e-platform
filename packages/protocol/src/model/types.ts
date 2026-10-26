export type ProtocolErrorCode = 'INVALID_ARGUMENT' | 'TIMEOUT' | 'ABORTED' | 'NETWORK_ERROR' | 'RESPONSE_LIMIT' | 'INVALID_JSON' | 'SCHEMA_MISMATCH' | 'STATUS_MISMATCH';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** The Standard Schema validation subset; Zod/Valibot/ArkType can implement it. */
export interface ProtocolSchema<T> {
  readonly '~standard': {
    readonly validate: (value: unknown) =>
      | { readonly value: T; readonly issues?: undefined }
      | { readonly issues: readonly unknown[] }
      | Promise<{ readonly value: T; readonly issues?: undefined } | { readonly issues: readonly unknown[] }>;
  };
}

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Opt in explicitly before sending a configured header to another origin. */
  readonly allowCrossOrigin?: boolean;
}

export interface HttpRequestOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** Mutually exclusive with body; serialized and given application/json. */
  readonly json?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}


/** Bring a real gRPC/RPC client; this interface does not implement any wire protocol. */
export interface RpcTransport {
  call(method: string, request: unknown, options: { readonly signal: AbortSignal; readonly timeoutMs: number }): Promise<unknown>;
  close(): Promise<void>;
}
