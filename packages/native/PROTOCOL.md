# Native bridge protocol, version 1

Canonical [JSON schemas and golden conformance fixtures](schema/README.md)
ship with the native package. They document serialization; authentication,
bounded execution, masking and stateful protocol rules still require the
runtime checks below. Schemas do not imply support for every listed action.

This bridge controls one owned application. It is not an OS-wide desktop
automation service. With `native()`/`qt()`, the application opts in to an embedded
helper; the Qt reference helper uses its event path rather than global OS input.
With `desktop()`, an owned OS accessibility sidecar launches the application and
scopes its tree to that process. The sidecar speaks the same protocol.

The embedded-helper engine launches `app.appPath` with `app.launchArguments`,
without a shell. The desktop engine instead launches the configured driver with
its literal argument prefix followed by `-- app.appPath ...app.launchArguments`.
The driver owns the target and removes `E2E_NATIVE_TOKEN` and `E2E_NATIVE_PORT`
from the target environment before launch. It must terminate its target when
the authenticated connection closes or shutdown is requested.
The child receives `E2E_NATIVE_TOKEN` (a fresh 32-byte random hexadecimal token)
and `E2E_NATIVE_PORT=0`. The helper listens on IPv4 loopback on an ephemeral TCP
port and writes exactly one readiness line to stdout:

```text
E2E_NATIVE_READY {"port":12345}
```

Each TCP frame is one UTF-8 JSON-RPC 2.0 request or response followed by LF.
Invalid UTF-8 is rejected rather than replaced during JSON decoding. Numeric
error codes must be integers, matching the canonical error-envelope schema.
Requests have positive integer IDs. One request is active per connection.
Notifications, unsolicited responses, unknown IDs and malformed frames are
protocol errors. They close the connection and fail the attempt even when no request
is pending or a valid response immediately preceded the bad frame. Default frame
limit is 16 MiB. Authenticate the first request;
reject every other method until authentication succeeds. Compare the complete
token, never log it, and close unauthorized connections. Stop the server with
the application. The engine connects only to `127.0.0.1`.

| Method | Parameters | Result |
| --- | --- | --- |
| `initialize` | `{protocolVersion:1,token:string}` | `{protocolVersion:1,name:string,version:string,actions:LocatorActionKind[],keyboard:boolean,screenshots:boolean,actionability?:boolean,windows?:boolean}` |
| `snapshot` | `{pixels?:boolean}` | `{root:SemanticNode,viewport:{width,height},location?:string,truncated?:boolean,screenshot?:Screenshot}` |
| `actionability` | `{ref:{id,revision},action:LocatorAction}` | `null` when ready; read-only, requires `actionability:true` |
| `perform` | `{ref:{id,revision},action:LocatorAction}` | `null` |
| `windows` | `{}` | `NativeWindow[]`; requires `windows:true` |
| `window.activate` | `{id:string}` | `null`; requires `windows:true` |
| `keyboard.type` | `{text:string,replace:boolean}` | `null` |
| `keyboard.press` | `{key:string}` | `null` |
| `screenshot` | `{}` | `Screenshot` |
| `shutdown` | `{}` | `null`, then stop the application |

The engine declares its capabilities before launch, then requires the helper
to support every declared capability. The helper must not advertise an action
it silently ignores. Unsupported node/action combinations return an explicit
error. The default profile declares `tap`, `fill`, `clear`, `focus`, `press`,
`check`, `uncheck`, `selectOption`, and `hover`; configure a narrower action
list for another helper. The `qt()` profile additionally declares `doubleTap`,
`secondaryTap`, `scrollIntoView` and `swipe`. Keyboard and screenshots can be disabled separately.
The OS accessibility profiles set both to false and declare only their supported
semantic actions; a driver must never silently emulate unsupported patterns or
claim a screenshot is masked without a verified masking implementation.

The optional `actionability` capability is additive to protocol v1. Omission or
false retains the earlier single-dispatch behavior. A helper declaring it must
implement a **read-only** preflight: it may inspect controls and readiness but
must not focus, scroll, change values, activate a window or dispatch input.
`NOT_ACTIONABLE` from this method means readiness has not been established;
the engine polls it within the remaining action/request budget. `NODE_STALE`
returns to the runner to resolve the locator again. Other errors stop the wait.
After a successful preflight the engine sends `perform` once. The helper must
revalidate the target immediately before dispatch because readiness can change
between calls. A failed or uncertain `perform` is never converted into another
preflight-and-mutation attempt. Only an explicit stale-reference response may
cause the runner to resolve again under its existing contract.

The optional `windows` capability enumerates at most 256 owned windows as
`{id:string,title:string,visible:boolean,active:boolean,modal:boolean}`. IDs are
nonempty, at most 512 UTF-16 units, unique in a response and never reused for a
different live object. Titles are at most 256 UTF-16 units; omit oversized or
sensitive titles as an empty string rather than publishing a prefix.
`window.activate` requests activation of one current handle and acknowledges
with `null`. It must enforce modal constraints and refuse unrelated windows.
Acknowledgement does not prove that the OS has granted foreground focus: tests
must poll the resulting active state. Activating a window invalidates old node
references, and the next snapshot may identify the newly selected root. The Qt
implementation covers cooperative Qt-owned windows; this does not imply global
OS window control, file dialogs owned by other processes, or embedded DOM access.
When `windows:true` is negotiated, an application-driven focus or modal change
may also select a different owned snapshot root. The helper must invalidate
references outside that selected root even without an activation request.

`LocatorAction` and `SemanticNode` are the public types from `@e2e-platform/core/engine`.
Common action payloads are `{kind:'tap'}`, `{kind:'fill',value,sensitive}`,
`{kind:'press',key}`, and `{kind:'selectOption',value}`, where an option is a
label string or `{label}`, `{value}`, or `{index}`. Check/uncheck operations
set the requested state rather than toggle it. Type and press must deliver
the relevant input events. Click modifiers and point actions are not declared
by this engine. Node IDs must be unique and survive observations while the
object lives; IDs must never alias a replacement object. The synthetic root
ID must remain stable across restart unless the negotiated windows capability
selects a different owned root. The runner owns reference revisions;
the helper checks the native object's lifetime by ID.

Mutation replies normally follow input dispatch. A cooperative GUI helper may
acknowledge accepted input when an application handler opens a nested modal
event loop, allowing the next request to observe and dismiss that dialog. This
acknowledgement establishes input acceptance, not completion of the application's
business logic; tests must assert the resulting state. The Qt helper bounds
outstanding nested mutations to eight, binds each reply to its original
connection and latches a later execution failure by closing that connection and
requiring an application restart. It must never hide a failed deferred action
or deliver its response to a replacement connection. Mutations are not retried.

Nodes expose accessible names/roles, text/value/testId, boolean states, optional
logical-pixel rectangles, string attributes, and children. The engine rejects
more than 20,000 nodes, depth greater than 64, duplicate IDs, invalid rectangles,
and malformed values. Set `truncated:true` when the helper intentionally omits
nodes. Do not pretend a partial tree proves a control is absent.

If the platform cannot establish a node's visibility, include
`states.visibilityKnown:false` (also on secure nodes). Omission retains the
existing `hidden` semantics. Unknown visibility cannot satisfy visible,
hidden, or negated visibility assertions. A role or `visible:true` query that
otherwise matches an unknown candidate fails with `UNSUPPORTED_CAPABILITY`,
so unknown visibility cannot become a false zero-match/absence result.
Use `states.enabledKnown:false` or `states.focusedKnown:false` when those states
cannot be established. Neither positive nor negated enabled/disabled/focused
assertions may pass from unknown state, enabled reads fail, and role queries
with a disabled-state predicate fail rather than discard an unknown candidate.

A secure node sets `states.secure:true` and includes no `value`, `text`,
`selection`, `attributes` or children. Its name may contain the control's real
accessible label, never its contents. Suppress sensitive source content before
serialization. A screenshot is:

```text
{base64:string,width:number,height:number,mimeType:'image/png',
 scale?:number,masked:true,maskedRegionCount:number}
```

Mask secure content at source, including custom secure controls. The count
must cover every secure node (hidden nodes may count as safely absent). The
adapter verifies this count, PNG header/dimensions and size bounds; an
attestation is a contract with trusted application code, not a proof that
arbitrary helper code has correctly found every secret. With `snapshot`
`pixels:true`, capture tree and masked pixels in one GUI-thread operation.
Omitting screenshot data withholds pixels. Raw, unmasked screenshots are
never accepted. `scale` maps physical image pixels to logical viewport pixels.

Errors use a JSON-RPC error envelope with `data.code` from the public engine
error taxonomy, for example:

```json
{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"stale object","data":{"code":"NODE_STALE"}}}
```

Only stale node/frame reads are retryable. If a sent mutation times out,
disconnects or is cancelled, its outcome is unknown: the engine raises
`ACTION_MAY_HAVE_COMMITTED`, closes the transport, and never repeats it.
Cancellation before dispatch is `CANCELLED`; a read timeout is
`OPERATION_TIMEOUT`. No general-purpose arbitrary-method fixture is exposed.

Per-attempt process restart isolates the process, not all files/settings the
application writes. The test must supply an isolated profile/data directory
when persistent application state matters. There is no automatic merged
Qt/embedded-browser/OS-dialog tree, window manager, clipboard, IME, pointer
fallback, or remote application support in version 1.
