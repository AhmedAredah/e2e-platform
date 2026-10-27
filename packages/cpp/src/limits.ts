/** Shared authoring-protocol budgets; diagnostics never quote input. */
export const MAX_LINE_BYTES = 1024 * 1024;
export const MAX_REQUESTS = 10_000;

/** Rejects malformed input without quoting application-controlled content. */
export function invalid(): never { throw new Error('Invalid C++ test protocol'); }
