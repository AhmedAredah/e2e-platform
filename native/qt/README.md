# Qt native helper

This C++17 library adds protocol-v1 automation to a cooperating Qt 6 application.
The runner and agent remain in TypeScript; a small helper runs on the Qt GUI
thread. It provides Qt Widgets and, when available, Qt Quick adapters. It does
not attach to arbitrary existing binaries or control the whole desktop.

Build it with the same Qt installation, compiler, architecture and build mode
as the test application. Qt Test does not promise binary compatibility across
Qt versions. Qt and its licenses remain the application's own dependencies;
this repository does not bundle a Qt distribution.

```sh
cmake -S native/qt -B native/qt/build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build native/qt/build --config Release
ctest --test-dir native/qt/build -C Release --output-on-failure
cmake --install native/qt/build --config Release --prefix /path/to/test-tools
```

Pass `-DCMAKE_PREFIX_PATH=/path/to/Qt/6.x/compiler` if CMake does not find Qt.
Use `-DE2E_QT_WITH_QUICK=OFF` for Widgets-only builds. The Quick control tests
also need the Qt Quick Controls QML runtime module (for example
`qml6-module-qtquick-controls` on Debian/Ubuntu). An installed copy exposes
`find_package(e2eQtBridge CONFIG REQUIRED)` and `E2E::QtBridge`. Alternatively:

```cmake
add_subdirectory(path/to/e2e/native/qt native-bridge)
target_link_libraries(my_test_app PRIVATE E2E::QtBridge)
```

Construct the helper after the application and show the window before starting
it. Keep the helper alive for the application lifetime:

```cpp
#include <e2e/qt/bridge.h>

window.show();
e2e::qt::Bridge bridge;
if (!qEnvironmentVariableIsEmpty("E2E_NATIVE_TOKEN") && !bridge.start())
    return 2;
return app.exec();
```

Only compile/link this helper into test builds. Without `E2E_NATIVE_TOKEN`,
`start()` creates no listener. The runner generates the token, launches the
application, reads its ephemeral loopback port and authenticates the first RPC.
Never log that token. This is an automation interface running with the
application's OS permissions, not a security sandbox.

## Organization

| Module | Responsibility |
| --- | --- |
| `Bridge` | Small public application-lifetime wrapper |
| `protocol/BridgeServer` | Authentication, bounded newline JSON-RPC and connection lifetime |
| `Surface` | Session policy, object actions, keyboard input and screenshot encoding |
| `ObjectRegistry` | Stable opaque IDs, QPointer lifetime checks and traversal limits |
| `adapters/ObjectAdapter` | Abstract toolkit surface contract |
| `adapters/WidgetsAdapter` | QWidget tree, control state, input and capture |
| `adapters/QuickAdapter` | QQuickItem visual tree and window input/capture |

The wire protocol is independent of Qt, so future wxWidgets/JUCE/other helpers
can speak it without importing Qt. The internal ObjectAdapter interface is a
Qt implementation seam, not a claim of existing support for those toolkits.

## Behavior and limits

- Set `objectName` to a stable test ID and accessible labels for meaningful
  role/name queries. IDs must be unique within the scope queried by the test.
- The semantic root is the current modal/active window; root ID is always
  `root`. Other IDs remain stable only while their object exists. The helper
  rejects stale IDs and objects outside the current observed view.
- Widget pointer input goes through the top-level QWindow's Qt event path
  after visibility, enabled-state, clipping and widget-overlap checks. It does
  not reproduce physical OS input, window-manager focus or native compositor
  occlusion. Quick pointer actions check viewport/clipping and the topmost
  visual hit path before dispatch: the hit must belong to the requested item
  or its descendants, with no unrelated item holding the mouse grab. Covered
  targets fail without sending pointer input. This conservative check also
  rejects visual overlays that might forward input. Arbitrary event filters,
  pointer handlers and custom input routing still need dedicated adapters;
  the helper does not claim a general scenegraph visibility oracle.
- Printable ASCII text emits Qt key press/release events. Other text uses
  Qt input-method commits. This tests Qt text handling, not a particular OS
  keyboard layout, physical key location or IME composition sequence.
  `ControlOrMeta` selects Control on Windows/Linux and Command on macOS,
  accounting for Qt's default modifier translation and
  `AA_MacDontSwapCtrlAndMeta`. The macOS test lane exercises both modes.
- Input normally replies after dispatch. If an application handler opens a new
  modal window and enters a nested event loop such as `QDialog::exec()`, the helper acknowledges accepted
  input so the next request can inspect and close the dialog. That acknowledgement
  does not prove business logic completed: assert the resulting state. At most
  eight mutations may remain on nested stacks. A later execution failure is
  latched and closes the original authenticated connection; the application must
  restart before another session. Replies are bound to their original connection.
  A custom nested event loop without a newly opened modal window still relies on
  the runner's operation deadline and is not automatically acknowledged early.
- Widgets support input, buttons, check/radio state and non-editable QComboBox
  selection by exact unique label, string user data or zero-based index.
  Disabled or non-selectable options are refused; navigation skips disabled
  options and detects model changes and rejected input.
  Quick supports text, buttons, checkable controls and non-editable Qt Quick
  Controls ComboBox selection by exact label, string valueRole or zero-based
  index. Public `textAt`/`valueAt` lookups resolve the option, then Qt keyboard
  events change the selection and deliver `activated` signals. Intermediate
  navigation also activates intervening options; assert application state after
  selection. Models are limited to 10,000 items; duplicate labels/values require
  an explicit index. Missing/invalid options, disabled/hidden controls and open
  popups are refused before selection input. Editable ComboBoxes and custom
  delegate input semantics require separate adapters. Model changes or rejected
  navigation after dispatch report an uncertain action, never a silent success.
  Model/view virtual cells, custom canvases,
  clipboard, drag/drop, native dialogs and embedded WebEngine DOMs need
  additional adapters; this helper does not manufacture their semantics.
- Password/no-echo editors and objects marked `e2eSecure=true` are redacted
  before serialization; their descendants are omitted and screenshot regions
  are painted black. Detected password/secure controls and sensitive-fill targets
  remain secure in helper-owned state for their remaining lifetime, including
  after a password-reveal toggle, when an application declares a
  constant/read-only marker, rejects property writes, or later clears its own
  marker. Destroying the object releases that state; replacement objects do
  not inherit it. Quick input checks that the intended control retains keyboard
  focus before each key so redirected focus cannot receive subsequent secret
  text. Mark custom secret controls explicitly. The runner also applies its
  own secret policy. App-owned logs/files and arbitrary rendering of secrets
  elsewhere are not discovered automatically.
  Captures monitor declared security properties and Quick transforms, then
  compare the secure-region geometry and count again after rendering. A changed
  frame is discarded and retried; a surface that keeps changing is refused.
  The tree accompanying pixels is serialized after capture-induced polishing.
  Declare a mutable C++ `e2eSecure` property with a `NOTIFY` signal and emit it
  whenever the value changes; ordinary QML properties already notify. A
  non-constant declared marker without `NOTIFY` is always treated as secure,
  even while false, because changes during painting cannot be observed reliably.
  A `CONSTANT` marker retains its declared value. Keep markers set for as long
  as controls hold secrets, and do not suppress their change notifications.
- Traversal is capped at 20,000 nodes, 64 levels and 4 MiB of node data, requests at 1 MiB, replies
  at 12 MiB, text input at 65,536 UTF-16 units and images at 16 megapixels.
  A truncated observation is marked. One authenticated connection is served.
  Oversized individual text fields and fields containing NUL are replaced
  entirely with a fixed omission marker. Prefix clipping or character removal
  could make a registered secret unrecognizable to the runner's later redaction.
- `snapshot({pixels:true})` captures tree and masked image in the same
  GUI-thread operation. Offscreen captures test Qt rendering; use real desktop
  sessions for platform integration and GPU/native behavior.

See [the protocol](../../packages/native/PROTOCOL.md) and the
[working examples](../../examples/with-qt/README.md). The helper source is under
the [MIT license](LICENSE). Its Qt dependencies have separate licenses, described
in [THIRD_PARTY.md](THIRD_PARTY.md). CMake installs both files under
`share/licenses/e2eQtBridge` (or the configured `CMAKE_INSTALL_DATADIR`), alongside
the installed development package. Preserve those files when redistributing it.

Primary references: [Qt Test](https://doc.qt.io/qt-6/qttest-index.html),
[Qt Quick Test](https://doc.qt.io/qt-6/qtquicktest-index.html),
[Qt object/QML inspection](https://doc.qt.io/qt-6/qtqml-cppintegration-interactqmlfromcpp.html),
[Qt Quick ComboBox](https://doc.qt.io/qt-6/qml-qtquick-controls-combobox.html),
and [Qt accessibility](https://doc.qt.io/qt-6/accessible.html).
