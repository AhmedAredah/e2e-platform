/**
 * Transport: one POST of every event a CLI invocation produced to PostHog's
 * batch endpoint. The key is the project's public, write-only ingestion key,
 * the kind websites embed in their pages; it can add events and nothing else.
 *
 * The request is bounded and quiet. It aborts when the caller's signal does,
 * never retries, and swallows every failure: telemetry that is lost is
 * telemetry, telemetry that delays or fails a command is a bug.
 */

import type { JsonValue } from '../types.ts';

/** Explicit transport configuration. This fork supplies no CLI destination. */
export interface TelemetryDestination {
  readonly host: string;
  readonly projectKey: string;
}

/** One item of the batch, exactly as PostHog receives it; `distinct_id` is a property. */
export interface PostHogEvent {
  readonly event: string;
  /** RFC 3339. */
  readonly timestamp: string;
  readonly properties: Readonly<Record<string, JsonValue>> & { readonly distinct_id: string };
}

export interface PostBatchOptions {
  /** Aborts the request: the caller's one deadline for everything telemetry does after the command. */
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
  readonly destination: TelemetryDestination;
}

/** Sends the batch; resolves to whether PostHog accepted it. */
export async function postBatch(events: readonly PostHogEvent[], options: PostBatchOptions): Promise<boolean> {
  try {
    const response = await options.fetch(`${options.destination.host}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: options.destination.projectKey, batch: events }),
      signal: options.signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}
