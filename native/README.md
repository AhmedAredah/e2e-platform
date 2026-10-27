# Native application extensions

This directory contains application-side helpers, a C++ test-authoring SDK and
optional platform process supervisors. TypeScript packages under
`packages/` own the test runner integration, process lifetime, transports and
validation. Keeping those responsibilities separate lets another toolkit
reuse the runner and protocol without acquiring a dependency on Qt.

## Existing class boundaries

| Layer | Abstract or extensible class | Current implementation |
| --- | --- | --- |
| Executable supervision | `ProcessRunner` | `LocalProcessRunner` |
| Native runner integration | `NativeEngine`, protected factories | `native()`, `qt()` and `desktop()` |
| Native semantic surface | `NativeDriver` | `RpcNativeDriver` |
| Native request transport | `NativeTransport` | `JsonRpcTcpTransport` |
| Qt toolkit surface | C++ `ObjectAdapter` | `WidgetsAdapter`, `QuickAdapter` |
| Qt application extensions | Public C++ `ControlAdapter` | Application-provided control adapters registered with `Bridge` |
| Output expectations | `OutputValidator<T, Options>` | Numeric, JSON and CSV validators |
| Terminal I/O | `TerminalTransport` | `NodePtyTransport` |
| HTTP I/O | `HttpTransport` | `FetchHttpTransport` |

Inheritance supplies the stable contract; collaborators supply transport,
capture and validation behavior. Each implementation owns a focused module.
For example, a domain-specific validator can extend `OutputValidator` and inherit
its assertion behavior. Another transport can extend `NativeTransport`, while
an engine subclass overrides its protected factory to inject that transport.
The public contracts and representative subclass tests live beside each package.

## Add another GUI toolkit or platform

Use `native/<toolkit>/` for a new application-side helper and
`examples/with-<toolkit>/` for its smallest real demonstration application.
Follow this sequence:

1. Identify the actual observable boundary: a toolkit object tree, an OS
   accessibility tree, a terminal, a browser or an application service. Use the
   existing process, terminal, web or HTTP modules when they already match it.
2. Implement the [native protocol](../packages/native/PROTOCOL.md) in the helper
   when a semantic GUI surface is appropriate. Keep GUI-thread dispatch, object
   identity, lifetime checks, control adapters and protocol framing in separate
   modules. Do not expose arbitrary function evaluation to the agent.
3. Define a toolkit-local abstract surface/control adapter and derive concrete
   adapters for supported control families. Qt's `ObjectAdapter` is an example;
   it is Qt-specific and should not become a dependency of a wxWidgets or JUCE
   helper. Reuse the wire contract instead.
4. Advertise only implemented capabilities. Unsupported controls/actions must
   fail explicitly. Preserve stable opaque IDs, disabled/hidden state, modal
   scope, sensitive-data masking and bounded observations.
5. If the same wire contract suffices, use the existing `RpcNativeDriver` and
   `NativeEngine`. Introduce another derived driver or transport only when the
   behavior actually differs. Keep framework-specific code out of the core runner.
6. Add contract tests, real compiled sample applications, passing workflows and
   planted defects. Exercise cancellation, crashes, stale controls, modal loops,
   connection loss during mutation, secret handling and process cleanup.
7. Record the OS, architecture, compiler, toolkit version and input backend used.
   A toolkit event path, an accessibility action and physical desktop input are
   different capabilities. Qualify each supported configuration separately.

## Folder responsibilities

`qt/include/` is the installed consumer API; `qt/src/adapters/` implements toolkit
surfaces; `qt/src/protocol/` owns the authenticated service; `qt/tests/` exercises
the compiled helper. `ObjectAdapter` and its derived classes remain internal helper
seams. Public `<e2e/qt/control_adapter.h>` provides a source-level `ControlAdapter`
contract, registered with `Bridge::registerControlAdapter` before startup on the
GUI thread. Build custom adapters with the same Qt/compiler kit; this is not a
cross-version binary plugin ABI. Custom adapters disable helper screenshots until
their capture and masking behavior can be qualified. Static and shared builds export
the `Bridge` API. `pnpm verify:qt:install` builds independent
`find_package(e2eQtBridge CONFIG REQUIRED)` consumers of both installed variants.

The helper has its own [MIT license](qt/LICENSE) and
[dependency notice](qt/THIRD_PARTY.md), which are installed with its CMake package.
Keep future helper folders equally self-contained, with their own build
configuration, public headers, internal modules, license information and tests.

## OS accessibility sidecars

| Directory | Language | Boundary |
| --- | --- | --- |
| [linux-atspi](linux-atspi/README.md) | Python | AT-SPI provider, bounded protocol session and owned Linux application |
| [windows-uia](windows-uia/README.md) | C# | UIA pattern adapters, bounded server and Job Object process ownership |
| [macos-ax](macos-ax/README.md) | Rust | AX provider trait, system FFI, protocol and owned child process |

Each sidecar implements the same authenticated application-control protocol and
is installed separately. The TypeScript `DesktopEngine` supplies the sidecar
command and application argv. No native-language implementation duplicates the
runner's scheduler or reports. Read [DESKTOP.md](../DESKTOP.md) for prerequisites,
capabilities and experimental status. Portable tests do not establish live OS
behavior. Dedicated custom-control, scene-engine and embedded adapters remain
future integrations; see [SUPPORT_MATRIX.md](../SUPPORT_MATRIX.md).

`cpp-sdk/` is the C++ authoring surface used by `@e2e-platform/cpp`. It connects
compiled test bodies to the shared runner rather than introducing another
scheduler or report format. `windows-process/` is the optional Job Object
supervisor for process tests; it is independent of the UIA accessibility sidecar.
Both require separate native builds. Their package documentation defines the
supported calls, installation and runtime qualification limits.
