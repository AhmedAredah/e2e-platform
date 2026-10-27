# Rust AppKit desktop fixture

This is a real macOS application written in Rust. It constructs standard AppKit
text, secure text, button and checkbox controls through the system Objective-C
runtime. It supplies accessible identifiers and names and a deterministic
button handler. The test runner remains TypeScript; the language of the
application does not determine which accessibility driver can inspect it.

```sh
cargo build --locked --manifest-path examples/with-desktop/rust/Cargo.toml
cargo build --locked --manifest-path native/macos-ax/Cargo.toml
python3 native/macos-ax/scripts/verify-macos.py \
  --driver native/macos-ax/target/debug/e2e-platform-macos-ax \
  --app examples/with-desktop/rust/target/debug/e2e-desktop-rust-demo
```

Run on an interactive macOS desktop and grant the driver Accessibility
permission first. This fixture has been typechecked on Linux with
`--features check-macos`; that does not establish macOS linking or GUI behavior.
The live verifier intentionally refuses to pass on Linux or without permission.
It checks actual control mutations, secure value omission and owned application
cleanup. It then launches the fixture with `--wrong`, which deliberately changes
the button's output, and requires the same positive output assertion to reject it.

`src/appkit/accessible_controls.rs` demonstrates application-owned accessibility
extensions through native AppKit subclasses. A selectable container updates real
radio controls and an independent result field through `AXSelectedChildren`.
A scroll-accessible button implements the advertised `AXScrollToVisible` action
by scrolling its enclosing `NSScrollView`. The live verifier checks mutation-free
preflight, selection by label/index/identifier and an actual clipped-to-visible
transition. These are explicit application integrations, not a claim that every
standard AppKit control exposes those optional attributes/actions.
