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
| `Bridge` | Public application-lifetime wrapper and adapter registration |
| `ControlAdapter` / `ControlSnapshot` | Versioned public custom-control source contract |
| `protocol/BridgeServer` | Authentication, bounded newline JSON-RPC and connection lifetime |
| `Surface` | Session policy, object actions, keyboard input and screenshot encoding |
| `ObjectRegistry` | Stable opaque IDs, QPointer lifetime checks and traversal limits |
| `adapters/ObjectAdapter` | Abstract toolkit surface contract |
| `adapters/WidgetsAdapter` | QWidget tree, control state, input and capture |
| `adapters/WidgetTargets` | Lifetime-checked model indexes, actions, tabs and headers |
| `adapters/QuickAdapter` | QQuickItem visual tree and window input/capture |

The wire protocol is independent of Qt, so future wxWidgets/JUCE/other helpers
can speak it without importing Qt. The internal ObjectAdapter interface is a
Qt implementation seam, not a claim of existing support for those toolkits.

## Behavior and limits

- Set `objectName` to a stable test ID and accessible labels for meaningful
  role/name queries. IDs must be unique within the scope queried by the test.
- The semantic root is the current Qt popup, modal or active window. Every
  window has a lifetime-stable opaque root ID; references from an old root are
  invalid after a new observation. `windows` lists at most 256 Qt-owned windows
  with opaque handles, titles, visibility, active and modal state.
  `window.activate` requests activation of an enumerated visible window and
  refuses activation behind another modal window. Activation is a request to Qt;
  assert the active window after the platform processes it. Neither RPC controls
  other processes or enumerates native OS dialogs.
- The helper advertises read-only `actionability` checks. The runner polls them
  within the operation deadline before dispatching input once. Checks include
  visibility, enabled state, clipping, toolkit hit testing and an unchanged
  target rectangle over at least 50 ms. Geometry stability is a bounded sample,
  not a guarantee that application animations or asynchronous work finished.
  Mutations that may already have run are never retried by this readiness path.
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
- Standard QWidget item views expose list options, table cells and tree items
  with text, edit-role values, selected/checked/expanded state and zero-based
  row/column attributes. QPersistentModelIndex keeps references attached to the
  same item across supported row moves/insertion; model resets, removal and
  replacement make old references stale. Tap selects through the viewport input
  path; `press` targets the current index (for example ArrowRight/ArrowLeft to
  expand/collapse a tree). `scrollIntoView` calls the view's public `scrollTo`.
  Check/uncheck uses the standard QStyledItemDelegate checkbox input rectangle;
  custom delegates require an application adapter. The helper does not call
  `setData` to fake user editing. Open an editor with the application's normal
  input and locate that editor separately. Lazy model rows must be loaded by the
  application; the helper does not call `fetchMore`.
- QMenu/QMenuBar actions, tabs and header sections have separate
  semantic nodes. Actionable tabs require `TrackedTabBar`/`TrackedTabWidget`
  (see below). Tap follows their Qt pointer event path. Checkable menu
  actions support check/uncheck, and tabs expose selected state. Tab additions,
  removals or changed labels/data conservatively invalidate old tab references.
  Header tapping follows the application's sorting/click handlers. Hidden,
  collapsed, disabled and offscreen virtual controls are refused before input.
  These adapters expose public widget/model semantics, not arbitrary pixels from
  a delegate or canvas.
- QAccessible roles and numeric value interfaces enrich both toolkit trees,
  including sliders, spin buttons, progress bars and custom Quick Accessible
  roles. This does not manufacture unsupported operations such as an absolute
  set-value action. Use keyboard input where the application supports it, or a
  custom adapter for application-specific actions.
- `scrollIntoView` also supports QScrollArea child widgets and existing items
  inside Qt Quick Flickable containers through public scroll-position APIs.
  Success requires the target center to be visible through its clipping ancestors.
  An already-visible target succeeds without movement. Clipped ordinary children
  without a supported scroll container fail explicitly; a dispatched scroll that
  cannot establish this postcondition reports `ACTION_MAY_HAVE_COMMITTED`.
  Quick model views expose instantiated visual delegates, not offscreen model
  rows. `swipe` sends a discrete Qt wheel event in the requested direction;
  momentum other than `none` is rejected. It is not a kinetic touch gesture.
  Custom canvases, clipboard, drag/drop, native dialogs and embedded WebEngine
  DOMs still require additional drivers or application adapters.
- Password/no-echo editors and objects marked `e2eSecure=true` are redacted
  before serialization; their descendants are omitted and screenshot regions
  are painted black. Detected password/secure controls and sensitive-fill targets
  remain secure in helper-owned state for their remaining lifetime, including
  after a password-reveal toggle, when an application declares a
  constant/read-only marker, rejects property writes, or later clears its own
  marker. Destroying the object releases that state; replacement objects do
  not inherit it. Widgets and Quick input check that the intended control
  retains keyboard focus before every key pair and Unicode commit segment, so
  redirected focus cannot receive subsequent secret text. A character-bearing
  key release is also stopped if the press handler redirected focus. Mark custom
  secret controls explicitly. The runner also applies its
  own secret policy. App-owned logs/files and arbitrary rendering of secrets
  elsewhere are not discovered automatically.
  Mark an entire model view `e2eSecure=true` when its model/delegates contain
  secrets; no general per-cell secret role is inferred. A sensitive QAction
  classifies its whole containing menu/menu bar as secure, hiding that subtree
  and masking its pixels, including QWidgetAction children and actions owned
  outside the visible QObject subtree.
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

## Application control adapters

Include `<e2e/qt/control_adapter.h>` and derive from `e2e::qt::ControlAdapter`.
Register a `std::shared_ptr` with `bridge.registerControlAdapter(adapter)` on
the GUI thread, before `bridge.start()`. Check its boolean result and
`bridge.errorString()`; duplicate names, unsupported interface versions, invalid
or duplicate actions, more than 64 registrations, registration after listening,
and registration from another thread are refused. Adapters are matched in
registration order, before default semantic handling, for QWidget/QQuickItem
objects. The bridge retains the shared pointer for its lifetime.

The version-one contract separates these responsibilities:

| Method | Contract |
| --- | --- |
| `interfaceVersion()` | Return 1; rebuild together with the Qt helper/compiler kit |
| `name()` | Unique bounded adapter name |
| `accepts(const QObject&)` | Read-only match for an application control |
| `snapshot(const QObject&)` | Return `ControlSnapshot` role, optional label/text/value/attributes and states |
| `actions()` | Explicit subset of the helper's documented action vocabulary |
| `ready(const QObject&, action)` | Read-only readiness; false triggers bounded waiting |
| `perform(QObject&, action)` | Dispatch exactly once through the application's intended control semantics |

Keep callbacks short and on the GUI thread. Retained object pointers must use
QPointer; a callback must not destroy a control while inspecting it. Do not throw
to request retries after mutation: exceptions from `perform` report
`ACTION_MAY_HAVE_COMMITTED`. An adapter is trusted application code, with the
same privileges as the application; the bridge cannot prove the semantics of
its callbacks. `ControlSnapshot::omitChildren` defaults to true; `secure=true`
makes the target and descendants permanently sensitive for that object's
lifetime. Set an explicit non-secret label; do not copy the secret into `name`.

The helper still applies Qt visibility, hit-testing, lifetime and observation
bounds around custom actions. Custom snapshots cannot supply arbitrary object
IDs, geometry or JavaScript. Registering an adapter disables screenshot capability
for the session because custom rendering does not establish a masking contract.
Use `qt({ screenshots: false })` for that application. Custom screenshot masking
and dynamically loaded binary plugins are not part of version one.

The [installed consumer](tests/consumer/main.cpp) compiles the public contract,
registers a concrete adapter and checks duplicate/thread rejection without
including private implementation headers. `ControlAdapter` is a source-level
extension point, separate from the internal toolkit `ObjectAdapter` ABI.

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

## Reviewed control and installation contracts

Use `<e2e/qt/tracked_tabs.h>` and `e2e::qt::TrackedTabBar` or
`e2e::qt::TrackedTabWidget` for actionable tabs. These extensible subclasses retain
normal Qt behavior and track insert/remove generations without occupying
application `tabData`. Structural hooks are final so subclasses cannot disable
tracking; override `onTabInserted`/`onTabRemoved` for additional behavior. Every structural change invalidates prior tab references,
including a remove/reinsert with identical labels and counts. Plain `QTabBar`
tabs remain observable, but mutations fail with `UNSUPPORTED_CAPABILITY` because
public Qt APIs cannot prove their lifetime. A registered application adapter is
another explicit integration option. Offscreen header/action scrolling also
returns `UNSUPPORTED_CAPABILITY`; it never acknowledges a no-op as success.

Combobox preflight resolves the requested option and its availability without
sending input. Secure `QQuickWindow` roots suppress titles and children and mask
the whole capture. Replacement typing uses the platform's standard Select All
binding, including macOS control/meta configurations. Widget focus requests
window raising and activation, and checks the outcome within a bounded wait before typing.
Raising is needed to reactivate a background application on Cocoa; a key-window
request alone does not establish application activation. A separate owned
foreground-process regression checks this behavior in the native Cocoa profile.
This does not bypass operating-system focus restrictions.

Installed CMake packages require the exact build Qt version, compiler family
and pointer width. Use the same compatible Qt/compiler/architecture kit or
rebuild the bridge; those checks cannot prove every ABI or plugin dependency.
Static/shared installed acceptance includes both Widgets and Quick consumers.
Set `-DE2E_QT_TEST_QPA=xcb` for an X11 build; the default comes from
`QT_QPA_PLATFORM` or `offscreen` and is recorded in the CMake cache. All detailed
CTest executables and their children use that selection. Delete the build cache
or pass a new value when changing platforms. Offscreen acceptance does not
qualify native desktop input routing.

On macOS, Qt 6.8.3 Quick Controls' native macOS style requires a Cocoa window.
The offscreen acceptance profile explicitly uses `QT_QUICK_CONTROLS_STYLE=Basic`;
the separate `cocoa` profile exercises the native `macOS` style. Detailed CTests
also default to Basic for macOS/offscreen only, overridable through
`E2E_QT_TEST_STYLE`. This setting belongs to the tests, not the installed bridge.
Applications launched offscreen should choose a compatible style explicitly.
The recorded failing backtrace reached `QMacStylePrivate::drawNSViewInRect` while
polishing a Quick button, before a bridge action. See Qt's
[native macOS style documentation](https://doc.qt.io/qt-6/qtquickcontrols-macos.html).

Explicit window activation invalidates prior observations before dispatch and
waits up to one second for Qt's focus window to match. Denied activation or
destruction returns `ACTION_MAY_HAVE_COMMITTED`; the helper does not acknowledge
an unconfirmed focus request or bypass operating-system focus restrictions.
