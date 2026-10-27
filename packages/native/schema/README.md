# Native protocol v1 serialization

`native-bridge-1.schema.json` describes the canonical JSON frames in
[`PROTOCOL.md`](../PROTOCOL.md). Its `$defs` expose readiness, request, response,
initialization, semantic node/snapshot, screenshot, owned windows, action and error vocabulary.
The readiness definition is the JSON payload after `E2E_NATIVE_READY `; it is
not itself a TCP request. Frames still use one UTF-8 JSON value followed by LF.

The golden conformance fixture contains positive and negative cases for all
seven baseline methods and the optional actionability/window methods, negotiated capabilities, mutation acknowledgements and secure
source data. Tests run them through JSON Schema and exercise the actual native
driver/parser with initialization, masked pixels and rejected secure-node leaks.
The schema's action and error enums are checked against the public engine API.
An action listed in the schema is vocabulary, not a claim that Qt implements it;
each helper must advertise its supported subset during initialization.

These are canonical serialization schemas, not a replacement for runtime
validation. JSON Schema cannot establish authentication, current/unique IDs,
request correlation, node-count/depth limits across a tree, capability support,
input side effects, secure-region coverage, pixel count, PNG integrity or the
image-to-viewport relationship. Runtime code enforces those contracts. It also
enforces byte/frame bounds and UTF-16 string lengths, while JSON Schema string
length counts Unicode code points. The Qt helper has its own tighter limits
(including 1 MiB requests, 12 MiB replies and 16 megapixels).

Implementations may reject more input than these structural schemas accept.
Some existing parsers tolerate omitted optional defaults or unknown fields;
new helper implementations should emit the canonical forms and must not rely
on that tolerance. The files document protocol version 1 and are shipped with
the native package; there is no code generation or new dependency at runtime.
