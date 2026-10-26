/** Complete-message redaction before the SDK serializes MCP protocol frames. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { processSecrets, redactJson } from '../internal/redact.ts';

/**
 * MCP IDs, method names, schemas and image bytes are protocol data. Only
 * returned prose, error details and logging payloads cross a text-redaction
 * boundary. In particular a secret equal to "text" or "1" must not rewrite
 * content types, request IDs, numeric results or base64 screenshots.
 */
export class RedactingStdioTransport extends StdioServerTransport {
  // fallow-ignore-next-line unused-class-member -- MCP SDK invokes this transport override through its Transport interface.
  override send(message: JSONRPCMessage): Promise<void> {
    const visit = (value: unknown, parent = ''): unknown => {
      if (Array.isArray(value)) return value.map((entry) => visit(entry, parent));
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
        if ((key === 'text' || key === 'message' || key === 'description') && typeof entry === 'string') {
          return [key, processSecrets.redact(entry)];
        }
        if (key === 'data' && (parent === 'error' || parent === 'params')) {
          return [key, redactJson(entry, processSecrets.redact)];
        }
        return [key, visit(entry, key)];
      }));
    };
    return super.send(visit(message) as JSONRPCMessage);
  }
}
