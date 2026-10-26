# @e2e-platform/protocol

Bounded HTTP clients for CLI, service, and end-to-end tests. Uses Node's built-in
`fetch`; no UI, model, or additional runtime dependency is required.

```ts
import { createHttpClient } from '@e2e-platform/protocol';
const api = createHttpClient({ baseUrl: 'http://127.0.0.1:8080', timeoutMs: 2000 });
const response = await api.post('/jobs', { json: { input: 'fixture.csv' } });
response.expectStatus(201);
const job: unknown = response.json();
// Assert fields with expect, or response.validate(aStandardSchema).
// Independently verify the job's files/database effects through your fixtures.
```

The deadline covers connection, headers, and full body consumption; caller
`AbortSignal` cancellation is supported. Decoded response bodies are limited to
8 MiB by default, including chunked responses. `maxResponseBytes` and `timeoutMs`
can be overridden per request. Response construction copies the supplied bytes,
including Node Buffers, and `bytes()` returns a defensive copy.

HTTP error statuses remain responses until checked. JSON parse and Standard
Schema validation failures have explicit error codes. Error summaries omit
response contents and validation issue details, which may contain credentials.
JSON decoding rejects malformed UTF-8 instead of replacing invalid bytes and
accepting a corrupted value; `text()` retains ordinary text-decoding behavior.
JSON parse errors do not retain the native parser error as a cause because its
message can quote response data in a test report.
Thrown schema errors, URL/header validation, JSON serialization, and unknown transport failures likewise
omit raw host error causes that could expose request credentials or payloads.
HTTP redirects are returned without following them; cross-origin requests require
an explicit opt-in before default headers can be sent to another origin.

Use `test.extend` to manage the service fixture's lifecycle. This client does not
start services, sandbox their effects, retry mutations, or infer correctness from
a successful status. `RpcTransport` is only an interface for a caller-provided
RPC implementation: no gRPC or WebSocket client is advertised by this package.

`ProtocolClient` defines common client operations. `HttpProtocolClient` centralizes
HTTP policy over an abstract `HttpTransport`; subclass that transport for an
existing connection or a controlled fixture. `FetchHttpTransport` implements the
bounded fetch operation, and `FetchHttpClient` selects it by default. The factory
delegates to `FetchHttpClient`; subclass tests verify serialization and effect
observation through a custom transport without duplicating HTTP policy.

Tests run after `pnpm build:native` from the repository root. The protocol suite
includes a built-CLI failure test that checks console output and report artifacts
for leaked response data.

Primary API references: [Node fetch](https://nodejs.org/api/globals.html#fetch),
[Standard Schema](https://standardschema.dev/).
