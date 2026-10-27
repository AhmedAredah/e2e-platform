# macOS Accessibility driver (Rust)

A PID-scoped, owned-application backend for `@e2e-platform/native`. The driver
can inspect any application's controls that expose the macOS Accessibility API;
its Rust implementation does not restrict application languages. This is a
semantic driver, with no screenshot or global keyboard backend.

## Build and run

Rust 1.85 or newer and the macOS system SDK are required to build the actual
backend. The locked dependencies must be available locally for offline builds.

```sh
cargo build --release --locked --manifest-path native/macos-ax/Cargo.toml
# Normally the TypeScript desktop engine supplies the token and owns this command.
E2E_NATIVE_TOKEN=<64-hex-characters> \
  native/macos-ax/target/release/e2e-platform-macos-ax -- \
  /absolute/path/Demo.app/Contents/MacOS/Demo --test-mode
```

Pass the actual executable, not an `.app` directory or `open -a`; launcher
processes which exit or hand off to another PID are outside this backend's
ownership contract. The application must remain in the launched PID. The driver
uses the inherited GUI session environment and removes the native token/port
from the application's environment. Target stdout/stderr are suppressed; use
explicit application log files if required.

Grant Accessibility permission to the driver in macOS System Settings. A denied
permission is `POLICY_DENIED` before application launch. The driver does not
request, grant or bypass permissions. Headless CI without a logged-in GUI session
is not GUI qualification.

## Implemented controls and boundaries

- `tap`: `AXPress` on controls that expose that action.
- `fill`/`clear`: writable `AXValue` on text fields, text areas and combo boxes.
  This is semantic value assignment, not simulated keystrokes or IME input.
- `focus`: writable `AXFocused`, with a known-enabled and semantically visible target.
- `scrollIntoView`: advertised `AXScrollToVisible` action, with no physical input fallback.
- `selectOption`: writable `AXSelectedChildren`, selecting one exposed direct child
  by exact accessible title/description, AXIdentifier (`value`) or zero-based index.
  Ambiguous, disabled, foreign-process, secure and out-of-range candidates are rejected.
  Popup-menu expansion and virtualized-item realization are not implemented.
- `check`/`uncheck`: read Boolean `AXValue` on checkbox/switch/radio controls and invoke
  `AXPress` only if the requested state differs. The driver confirms the transition
  without repeating the action; an unconfirmed outcome ends the session. A selected
  radio cannot be unchecked directly. Tests must still assert business outcomes.
- Accessible roles, names, identifiers, values, checked/selected/expanded/focus
  and enabled states, with bounded child traversal and a stable synthetic root.
- Secure text fields (`AXSecureTextField`) and explicit sensitive fills omit
  content, name, identifier, attributes and children before serialization.

No raw mouse input, keyboard events, screenshots, system-wide
root, cross-process dialogs, WebView DOM, attach-to-existing-PID or arbitrary
method evaluation is exposed. Unsupported combinations return explicit errors.
Custom painted or incorrectly labeled controls require application accessibility
work.

Visibility is explicit. The driver combines the application's `AXHidden`, the
window's `AXMinimized`, positive control geometry and ancestor/window clipping.
Known hidden or clipped controls carry `hidden:true`. Missing required evidence
carries `visibilityKnown:false`; it cannot prove either visibility or absence.
This is semantic viewport visibility, not OS occlusion or pointer hit testing.
Unknown `AXEnabled` is treated as non-actionable and carries `enabledKnown:false`.
Unavailable `AXFocused` is omitted and carries `focusedKnown:false`. Unknown
states cannot prove either a positive or a negated enabled/focused assertion.
These state flags are also present on secure nodes. Names use title/description and
an owned, nonsecure `AXTitleUIElement` label fallback. Canonical roles include
`listbox`, `option`, `grid`, `gridcell`, `treeitem` and `img`; numeric values and
provider-supplied placeholder text are bounded and omitted for secure controls.

The optional `actionability` protocol probe performs only reads and checks for
supported actions/settable attributes. The runner may poll an unready probe;
`perform` repeats checks and dispatches a mutation once. The probe never fills,
selects, focuses, scrolls or marks an element sensitive. All new control paths
remain experimental until the interactive acceptance suite qualifies them.
Names and values intentionally preserve full embedded-NUL strings so a
partial secret is not accidentally disclosed. Oversized fields are omitted in
full. `viewport` records the largest accessible window size, or 1×1 while no
window exists; there are no screenshot coordinates or pixel visibility claims.
Tree presence means AX exposure: it does not prove a window is unobscured or a
control physically visible. Do not use this backend to qualify pixel visibility.

References use retained AX object identity (`CFHash`/`CFEqual`) and never reuse
an allocated numeric ID within a session. A mutation must reference an object
in the most recent successful snapshot and revalidate its PID and role.
Destroyed/unavailable elements fail as stale. Accessible provider identity is
still an OS/provider contract; arbitrary defective providers cannot be certified.
The registry is bounded to 100,000 identities; restart the attempt if exhausted.
Snapshots cap nodes/depth and aggregate escaped JSON text to 4 MiB (including
duplicated value/text fields), flag partial traversal, individual field omissions or
text-budget exhaustion, and have a five-second budget. Fields are never partially
clipped to fit the text budget.
Every AX element has a 500 ms IPC timeout; individual blocked calls may finish
up to that timeout beyond the overall deadline.

## Lifecycle and security

The loopback server accepts one connection, authenticates before access, rejects
unknown/duplicate fields and replayed IDs, bounds frames and closes on protocol
faults. No token, supplied value or platform error text is reflected in errors.
An uncertain mutation closes the session without retrying it. Driver protocol
errors and unsupported features do not count as successful assertions.

The driver owns a fresh target process group. Normal shutdown/disconnect drops
and reaps that group. SIGTERM, SIGINT and SIGHUP handlers immediately send SIGKILL
to the owned group, even while Accessibility IPC is blocked. A watchdog also
terminates that group when the runner parent disappears. Abrupt SIGKILL of the
driver itself cannot execute cleanup; use external job containment if that
failure mode must be covered. Descendants that deliberately leave the process
group are outside this guarantee. Do not run untrusted applications with secrets.

## Validation status

```sh
cargo test --locked --manifest-path native/macos-ax/Cargo.toml
cargo check --locked --manifest-path native/macos-ax/Cargo.toml --features check-macos
cargo check --locked --manifest-path examples/with-desktop/rust/Cargo.toml --features check-macos
```

Portable protocol and process lifecycle tests run on Linux, including actual
loopback connections and child cleanup. `check-macos` typechecks the platform FFI
and startup code without linking Apple frameworks; the executable still rejects
non-macOS execution. It is not a GUI emulator and is not a macOS runtime pass.

The rc.3
[`desktop-contracts` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517430)
passed 23 Rust tests on macOS 15 and Ubuntu 24.04 and built the real AppKit
fixture on macOS at source revision
`3baeb8d6bd90b799f7784e67e24c9922d5e27b2f`. That job did not run the interactive
AX/AppKit acceptance procedure; native compilation and portable tests do not
establish GUI behavior.

The real Rust AppKit fixture and
[`scripts/verify-macos.py`](scripts/verify-macos.py) form the runtime qualification
check. Run the commands in
[`examples/with-desktop/rust/README.md`](../../examples/with-desktop/rust/README.md)
on macOS. Until that job passes, this backend is implemented but experimental and
unqualified for release claims. Permission-denied and unsupported-platform runs
must remain failures, not skipped successes.
The verifier runs the fixture twice, including its deliberately broken `--wrong`
mode, and requires the same expected-output assertion to reject that defect.

## Extension structure

`AccessibleProvider` is the behavior contract; `MacOsProvider` implements it.
`Action` is a closed typed operation enum. Protocol validation, strict JSON,
transport, process ownership and system API adaptation live in separate modules.
Rust traits and composition supply the extension points corresponding to abstract
classes in the other drivers; inheritance is not a Rust language feature.

Primary API references:

- [AXUIElementCopyAttributeValue](https://developer.apple.com/documentation/applicationservices/1462085-axuielementcopyattributevalue)
- [AXUIElementCopyAttributeValues](https://developer.apple.com/documentation/applicationservices/1462060-axuielementcopyattributevalues)
- [AXUIElementSetMessagingTimeout](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout)
- [AXUIElementPerformAction](https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction)

Source is MIT. `serde`, `serde_json` and transitive crates retain their own
licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). Apple frameworks are system
components, not copied into this repository or relabeled MIT.
