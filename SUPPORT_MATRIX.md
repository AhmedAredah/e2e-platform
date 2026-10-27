# Application and platform support

This branch adds process, native-bridge, terminal, protocol, C++ authoring and
output-checking modules to the existing e2e runner. It does not infer a GUI automation API from
the fact that an application was written in C++, Python, C# or Rust. The application boundary and
its exposed capabilities determine which module applies.

Install this candidate into another project using [INSTALL.md](INSTALL.md).

The extension source is included in this checkout. New package names are local
workspace packages, not a claim that these versions are published on npm.
A source archive, even one containing the complete Git history, does **not**
include installed JavaScript dependencies, browser downloads, CMake, compilers,
Qt development kits, optional PTY native dependencies or operating-system
accessibility permissions. Complete those prerequisites before an offline run.

## Included modules and support boundaries

| Module | Included behavior | Boundary |
| --- | --- | --- |
| `@e2e-platform/process` | Direct executable/argument invocation, bounded streams, deadlines, cancellation, exit contracts, supervised services with explicit readiness, runner diagnostics and owned-process cleanup | A pipe is not a terminal. Default Windows cleanup uses taskkill and cannot guarantee descendants after natural root exit. The optional separately built Job Object supervisor requires explicit configuration and native qualification. No OS sandbox or automatic database/service reset. |
| `@e2e-platform/cpp`, `native/cpp-sdk` | C++ authored test bodies connected to the shared runner through a bounded protocol | The C++ bridge supports its documented API; it does not imply every TypeScript fixture, browser command or third-party test framework is available from C++. Python, C# and Rust authoring SDKs remain absent. |
| `@e2e-platform/checks` | Explicit numerical tolerances, structural JSON and keyed CSV comparison, bounded mismatch reports | The application or test author supplies independent expected values. No automatic tolerance widening or golden-output acceptance. |
| `@e2e-platform/native` | Authenticated native engine, scoped semantic locators, explicit state waits, optional readonly actionability preflight, capability-negotiated actions and helper screenshots | Requires a compatible helper or separately installed OS sidecar. Mutation is dispatched once; uncertain outcomes are never retried. Unsupported or unknown observations cannot prove absence or visibility. |
| `native/linux-atspi`, `windows-uia`, `macos-ax` | Python AT-SPI, C# UIA, Rust AX providers; semantic actions, readonly preflight and supported scroll-to-visible operations | Historical Linux GTK3 reference controls have limited D-Bus/Xvfb qualification; the changed source needs new live results. Windows/macOS GUI acceptance remains unrun. No OS screenshots or global keyboard injection. |
| `native/qt` | Cooperative Widgets/Quick helper, Qt-owned window APIs, selected model/view items and public custom-control adapter registration | Toolkit event injection is not OS-wide input. Model-item behavior and virtualized controls are bounded by their adapters. Custom adapters use the existing action vocabulary and disable screenshots; qualify each control/kit/OS combination. |
| `@e2e-platform/terminal` | VT screen state and terminal sessions over a transport, with optional real PTY integration | Optional node-pty must be installed and compiled separately. Semantic terminal text and keyboard input are supported; no invented buttons, clicks, screenshots or universal graphics support. |
| `@e2e-platform/protocol` | Bounded HTTP requests, status checks, JSON and Standard Schema validation | An RPC transport extension point does not implement gRPC or WebSocket support. Use the process service fixture for launch/readiness; domain reset and expected outcomes remain application-specific. |
| Core `modelPolicy: 'forbid'` / `--no-model` | Explicitly prevents model use instead of relying on replay-cache availability | Cache replay does not replace fresh result assertions. Model-dependent operations must fail rather than silently call a provider. |

Qt Widgets and Quick share the bridge protocol but expose different trees and
control behavior. The reference apps demonstrate specific controls, not blanket
coverage of every Qt component. Native file dialogs, IME, OS clipboard control,
complex drag/drop, touch and multiple desktop sessions
are separate capabilities, not implied by common locator support.
Native video recording, visual-diff baselines, download/upload workflows and
Qt WebEngine/CEF DOM-to-native context switching are not implemented. Qt-owned
windows are distinct from foreign-process OS dialogs; OS sidecars may observe
multiple windows in the launched PID but do not advertise the Qt window API.

The same process module can test CLI11, Boost.Program_options, cxxopts or another
parser without parser-specific drivers. Wt and other C++ web applications can use
the existing web engine against their browser interface. GTK, wxWidgets, JUCE,
FLTK, ImGui, games and embedded displays require qualified drivers or helpers;
this branch does not advertise dedicated drivers for them.

## Framework coverage matrix

“Experimental” means source capability exists but the named OS/toolkit/build
combination still needs its own recorded qualification. No Windows/macOS runtime
result is inferred from Linux tests or from workflow configuration.

| Application family | Current route | Status of dedicated support |
| --- | --- | --- |
| CLI11, Boost.Program_options, cxxopts or other CLI parsers | Generic real-process fixture and output checks | Included; no parser-specific driver required. |
| Qt Widgets / Qt Quick | Cooperative helper, model/view adapters and registered custom controls | Implemented for the documented control subset; candidate OS/kit qualification is required. An adapter extension point is not universal custom-control support. |
| ncurses, FTXUI, notcurses | Generic VT/PTY terminal engine | Experimental keyboard/text route; no toolkit object tree or universal terminal graphics. |
| Wt or another C++ application serving browser content | Existing web engine plus server fixture | Browser route included; not a new native framework driver. |
| Drogon, Crow, oat++, Pistache, Boost.Beast HTTP services | HTTP protocol client plus service fixture | Included HTTP contracts; no framework-specific reset/discovery. |
| gRPC, WebSocket or custom RPC | Caller-provided transport | Not implemented by the HTTP module. |
| GTK/gtkmm, wxWidgets, Win32/MFC/WTL/WinUI, AppKit | AT-SPI, UIA or AX sidecar where the toolkit exposes controls | Conditional OS-backend route, not toolkit certification. Qualify the exact toolkit/control/OS versions using real applications. |
| Python GTK, WPF/WinForms, Rust AppKit | Real reference GUI fixtures with native driver acceptance scripts | Python GTK3 reference acceptance passed on Ubuntu 24.04 under D-Bus/Xvfb. WPF and Rust AppKit built on their native OSes; interactive GUI acceptance remains unrun. WinForms requires separate qualification. |
| PySide/PyQt, Tkinter, wxPython, Kivy, Avalonia/MAUI, Slint/egui/iced/Tauri | An eligible OS accessibility backend or a future specific adapter | No blanket toolkit certification; Qt Python binding, custom painting and hybrid DOM/native coordination remain separate work. |
| JUCE, FLTK | Eligible OS accessibility controls where the application exposes them; otherwise a future helper | No dedicated or qualified toolkit adapter. Accessibility exposure depends on framework/version/application behavior. |
| Dear ImGui | Future registered semantic tree or toolkit test-engine integration | No dedicated adapter or automatic control-tree extraction included; review integration licenses separately. |
| Qt WebEngine, CEF, Tauri and other native/web hybrids | Separately selected native controls or browser surface | No integrated native/DOM context switching or automatic embedded-browser attach. |
| SDL, SFML, GLFW, raylib, Unreal, Godot | Future scene/frame/input adapter or exposed process/protocol interface | No game/scene adapter included. |
| VTK/ParaView, OpenCV, Eigen and scientific libraries | Existing process, linked test harness, data checks; optional qualified host UI | No automatic renderer/library introspection. |
| LVGL, embedded Qt, QNX and physical devices | Future target-specific helper/transport | No hardware qualification or dedicated device backend included. |

## Architecture and folders

```text
e2e-platform/
  packages/
    e2e/                 Existing runner, agent policy, fixtures and reports
    process/src/         Process supervisor, capture and fixture modules
    cpp/src/             C++ authored-test protocol and runner bridge
    native/src/
      engine/            Engine lifecycle and capability negotiation
      driver/            Semantic native-driver contracts and RPC driver
      transport/         Authenticated request transport contracts and TCP transport
    checks/src/          Output validators and comparison modules
    terminal/src/        Terminal session and transport modules
    protocol/src/        HTTP and caller-provided RPC transport modules
  native/qt/             C++ Qt helper library and helper tests
  native/cpp-sdk/        Installed C++ test-authoring API
  native/linux-atspi/    Python AT-SPI driver
  native/windows-uia/    C# UIA driver
  native/windows-process/ Optional Windows Job Object supervisor
  native/macos-ax/       Rust AX driver
  examples/
    with-cpp-cli/        C++17 calculator; CMake, CTest and e2e tests
    with-qt/             Widgets/Quick examples and native-engine tests
    with-desktop/        Native platform accessible-control fixtures
    with-languages/      Python/C#/Rust CLI and HTTP fixtures
  scripts/native/        Cross-platform build and executable verification
  docs/cpp.mdx           User guide
  .github/workflows/native.yml
```

| Extension contract | Included implementation | Source module |
| --- | --- | --- |
| `ProcessRunner` | `LocalProcessRunner` | [Process supervision](packages/process/src/process/runner.ts) |
| `NativeTransport` | `JsonRpcTcpTransport` | [Transport](packages/native/src/transport/native-transport.ts) |
| `NativeDriver` | `RpcNativeDriver` | [Native driver](packages/native/src/driver/native-driver.ts) |
| `NativeEngine` protected factories | `native()` / `qt()` / `desktop()` handles | [Runner integration](packages/native/src/engine/native-engine.ts) |
| `OutputValidator` | `NumericValidator`, `JsonValidator`, `CsvValidator` | [Validators](packages/checks/src/validators/base.ts) |
| `TerminalTransport` | `NodePtyTransport` | [Terminal transport](packages/terminal/src/transport/base.ts) |
| `HttpTransport` | `FetchHttpTransport` | [HTTP transport](packages/protocol/src/transport/http.ts) |

Object-oriented extension points separate responsibilities without rewriting the
stable upstream runner. `ProcessRunner` supplies the finite-command/exit contract;
`LocalProcessRunner` implements local launch and session ownership. Subclass the
supervisor for another execution environment while preserving cancellation,
output bounds and cleanup. `ProcessWorkspace` manages a test's process ownership
and temporary working directory.

`NativeEngine` owns runner integration and can be subclassed through its driver
and transport factory methods. `NativeDriver` defines coherent snapshots and
supported actions; `RpcNativeDriver` implements that contract over a
`NativeTransport`. A new toolkit can supply another driver, while a different
local transport can preserve the same protocol. Mutating requests must not be
retried automatically after an uncertain outcome.

For example, a transport decorator can add timing while retaining the public
abstract contract:

```ts
import { NativeTransport, type RequestContext } from '@e2e-platform/native';

class TimedTransport extends NativeTransport {
  constructor(private readonly delegate: NativeTransport) { super(); }

  override async request(method: string, params: unknown, context: RequestContext, mutates = false): Promise<unknown> {
    const started = performance.now();
    try {
      return await this.delegate.request(method, params, context, mutates);
    } finally {
      // Record method and duration only; params/results may contain private data.
      console.error(`${method}: ${performance.now() - started} ms`);
    }
  }

  override onDisconnect(listener: () => void): () => void {
    return this.delegate.onDisconnect(listener);
  }

  override close(): void { this.delegate.close(); }
}
```

`OutputValidator<T, Options>` supplies the independent compare/assert contract;
`JsonValidator`, `CsvValidator` and `NumericValidator` implement selected
output semantics. Functional comparison helpers remain available for simple
tests. A domain validator can override `compare` while preserving bounded
`ComparisonResult` evidence and inherited assertion behavior.
`TerminalEngine`, `TerminalSession`, abstract `TerminalTransport` and its
`NodePtyTransport` implementation separate VT state from real PTY I/O. The HTTP
module keeps client behavior separate from response validation; an RPC transport
contract leaves implementation to the caller. Prefer a small subclass or injected collaborator for new behavior;
add a shared primitive only when its semantics, deadlines and replay policy are
clear across implementations. These abstractions do not promise that any remote
transport, toolkit or validator already exists.

The C++ examples require the full checkout and built local packages. The
inherited initializer does not install these unpublished fork packages or fetch
the helper. Use the source workflow below, or install the checksummed kit using
[INSTALL.md](INSTALL.md).

## Build and run from source

Use the Node version accepted by the repository's `package.json`, its pinned
pnpm version, CMake 3.21 or newer, and a C++17 compiler. Windows needs Visual Studio
C++ build tools; macOS needs Xcode command-line tools; Linux needs GCC or Clang.
Install the selected Qt 6 development kit for Qt builds. Optional terminal PTY
support may need a native build toolchain and its documented peer dependency.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/native/verify.mjs
```

The verification script uses the **built** local packages, compiles the reference
C++ executable with CMake, runs CTest, and invokes the built e2e CLI. It also runs
a separate planted-defect suite and requires an assertion failure. A missing
dependency, crash, skipped suite or infrastructure error does not count as
successful defect detection. The script downloads nothing. CMake File API metadata identifies the current
configuration's executables, so an orphaned older binary cannot count as a
successful build. Controller commands also use the owned-process supervisor.

With a compatible Qt development kit installed and a desktop available:

```bash
node scripts/native/verify.mjs --qt
```

On Linux, a real X11 window can be exercised under Xvfb:

```bash
xvfb-run -a node scripts/native/verify.mjs --qt
```

`QT_QPA_PLATFORM=offscreen` can exercise helper semantics where supported, but
offscreen success does not qualify OS routing, compositor behavior, display
capture or Wayland. Headless, real-desktop, GPU and shipped-binary lanes are
different evidence.

## Evidence and qualification

The CLI verifier writes positive and planted-negative runner reports under
`examples/with-cpp-cli/.e2e/`; explicit stdout/stderr/exported JSON evidence lives
in its `cpp-evidence/` subdirectory. CTest emits `build/ctest-results.xml`.
A machine-readable verification summary is written to `.e2e/cpp/verification.json`.
Qt example reports are under `examples/with-qt/e2e/.e2e/`.

The workflows configure Windows, macOS and Linux command/Qt jobs, Linux Xvfb
coverage and separate manual interactive desktop profiles. A workflow definition
is not evidence those jobs have run: retain the actual reports for each
OS/architecture/toolchain/Qt kit and each source revision.
The rc.4 [`languages` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40431659168)
qualified the Python/C#/Rust CLI/HTTP reference scenarios on all three operating
systems at commit `50e3a377f0299f73a0472a012f85a893f7cb8c5d`. This does not
qualify native GUI behavior or resolve that checkpoint's Windows/macOS native
package-test failures; see [RELEASE_STATUS.md](RELEASE_STATUS.md).

For OS accessibility drivers, the rc.3
[`desktop-contracts` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517430)
provides limited live GTK3 evidence plus native Windows/macOS build and portable
test evidence. It does not establish an all-CI pass or interactive UIA/AX behavior.
See [RELEASE_STATUS.md](RELEASE_STATUS.md) for the exact tested source revision.

Before adding a supported configuration, exercise both passing and failing
reference cases: bad numerical output behind a success message, crashes/hangs,
output backpressure, expected nonzero exits, cleanup, cancellation, stale or
ambiguous UI identities, disabled/hidden controls and modal dialogs. Application
crashes must remain distinct from driver/provider/setup failures. Report input
fidelity and the active backend; do not silently reinterpret a failed semantic
action as a coordinate click.

Performance measurements need warmups, repetitions and comparable machines.
Measure application latency independently from model latency. ASan, UBSan and
TSan are separate supported-build lanes and add overhead; a sanitizer build is
not a release performance baseline. Dump collection, sanitizers, hardware-device
transport and GPU qualification are not automatically supplied by a GUI helper.

## Trust, licensing and source references

Tests, configuration, custom tools, drivers and committed replay data are trusted
code with host authority. This is not an OS sandbox. Use an isolated environment
for untrusted applications/test code. Native helper sessions must authenticate
and limit requests; do not expose arbitrary C++ evaluation, unbounded method
invocation or shell execution to the testing agent. Local IPC alone is not a
complete authentication policy.

Explicit raw process logs and artifacts written outside the runner can contain
private data. Review evidence before sharing it; known-value redaction does not
identify every secret or constrain trusted test code. Preserve the upstream MIT
copyright and permission notice and review Qt and other dependency licenses
separately. See [LICENSE](LICENSE),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[source provenance](docs/development/LICENSING.md) and [SECURITY.md](SECURITY.md).

Primary references for these boundaries:

- [Node child processes](https://nodejs.org/api/child_process.html): pipes, streams and direct process invocation.
- [CMake/CTest](https://cmake.org/cmake/help/latest/manual/ctest.1.html) and [resource locks](https://cmake.org/cmake/help/latest/prop_test/RESOURCE_LOCK.html): executable tests and shared-desktop coordination.
- [Qt threading](https://doc.qt.io/qt-6/threads-qobject.html): QObject and GUI thread constraints.
- [Qt plugin deployment](https://doc.qt.io/qt-6/deployment-plugins.html) and [module compatibility](https://doc.qt.io/qt-6/qtmodules.html): kit/build compatibility, including Qt Test and Qt Quick Test exceptions.
- [Qt local sockets](https://doc.qt.io/qt-6/qlocalserver.html): platform-specific permission limitations.
- [Qt accessibility](https://doc.qt.io/qt-6/accessible.html): exposed control semantics and custom controls.
- [GoogleTest numerical assertions](https://google.github.io/googletest/reference/assertions.html): explicit numerical comparison criteria.
- [ASan](https://clang.llvm.org/docs/AddressSanitizer.html), [UBSan](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html), [TSan](https://clang.llvm.org/docs/ThreadSanitizer.html) and [benchmark variance](https://google.github.io/benchmark/reducing_variance.html): separate diagnostic and performance lanes.
