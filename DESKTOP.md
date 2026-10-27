# Desktop applications

`e2e-platform` uses one TypeScript test runner, with a bounded C++ test-authoring
bridge for the documented native API. Choose a driver by the application's
control surface and operating system, independently of its implementation language.
The desktop backends are explicitly installed components; the CLI/HTTP installation
kit does not require Qt, a graphical session, Python, .NET or Rust.

| Backend | Implementation | Application interface | Deployment |
| --- | --- | --- | --- |
| `qt()` | C++ Qt 6 bridge | Cooperative Qt Widgets and Qt Quick Controls | Link the helper into the application's test build |
| `desktop({ backend: 'linux-atspi', ... })` | Python | Linux AT-SPI accessibility tree | Launch the Python sidecar in a desktop/D-Bus session |
| `desktop({ backend: 'windows-uia', ... })` | C#/.NET | Windows UI Automation patterns | Build and launch the Windows sidecar in an interactive session |
| `desktop({ backend: 'macos-ax', ... })` | Rust | macOS Accessibility attributes/actions | Build and launch the macOS sidecar with Accessibility permission |

The sidecars launch and own one application. They do not attach to arbitrary
pre-existing programs. Use an actual executable: an interpreter plus script for
Python, `dotnet` plus a built assembly for .NET, or a compiled app for C++/Rust.
Do not pass shell commands, `cargo run`, `dotnet run`, macOS `open`, or a launcher
that immediately hands work to a different process. OS tree scope follows the
owned application's PID. See each backend README for its process limitations.

## Install

Install the checksummed JavaScript kit as described in [INSTALL.md](INSTALL.md).
Build/install only the selected driver using these instructions:

- [Python Linux AT-SPI](native/linux-atspi/README.md)
- [C# Windows UIA](native/windows-uia/README.md)
- [Rust macOS AX](native/macos-ax/README.md)
- [C++ Qt bridge](native/qt/README.md)

System accessibility libraries, .NET targeting packs, Cargo dependencies and Qt
remain separately licensed prerequisites. The repository contains their integration
source, not a bundled operating system or every dependency needed for a cold offline
build. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Configure the runner

This example runs the Linux Python driver from the extracted repository using
an interpreter with the required system accessibility packages. Paths are explicit so the test does not accidentally use another
runtime. Pass the desktop session variables needed by your environment deliberately.

```ts
import type { E2EConfig } from '@e2e-platform/core';
import { desktop } from '@e2e-platform/native';

export default {
  modelPolicy: 'forbid',
  targets: [{
      name: 'desktop',
      engine: desktop({
        backend: 'linux-atspi',
        executable: '/absolute/path/to/python',
        args: ['/absolute/path/to/e2e-platform/native/linux-atspi/driver.py'],
      }),
      app: {
        appPath: '/absolute/path/to/python',
        launchArguments: ['/absolute/path/to/my_gui.py'],
      },
  }],
  workers: 1,
} satisfies E2EConfig;
```

Use the selected driver's README for the exact interpreter/module name, environment
and executable command. The Windows profile takes the compiled UIA driver executable;
the macOS profile takes the compiled AX driver executable. `appPath` identifies the
application, while `executable` identifies the driver. Qt continues to use `qt()` and
the application's linked bridge without a sidecar.

Tests use the existing `app`, locators and `expect` fixtures. Call `app.open()`, locate
by accessible role/name or test identifier, perform an action, and assert the resulting
state. Assertions are essential: an accepted accessibility action is not evidence
that an application's business operation succeeded. CLI and HTTP tests keep using
`@e2e-platform/process` and `@e2e-platform/protocol`.

## Controls and extension contracts

Every driver advertises a finite set of implemented actions during authentication.
A control must also expose the applicable pattern/interface. Unsupported combinations
raise an explicit error; no action silently becomes a click at guessed coordinates.
The new OS profiles do not advertise screenshots, global keyboard typing, hover,
drag/drop, clipboard, IME, touch, embedded browser DOM or system-wide dialogs.
These are separate future capabilities, not implied by basic accessibility support.

All three OS providers advertise readonly actionability preflight and semantic
`scrollIntoView` when the specific control exposes the platform operation. The
runner can poll preflight safely before dispatching an action once. It never
replays a mutation whose result is uncertain. UIA uses ScrollItemPattern, AT-SPI
uses Component.scroll_to, and AX requires AXScrollToVisible. Scrolling does not
imply arbitrary pointer-wheel injection or virtualized-item realization.

AX selection supports writable AXSelectedChildren with a unique direct child
selected by label, AXIdentifier or zero-based index. A popup that requires menu
expansion is unsupported. AX visibility uses explicit application/window state
and viewport geometry; missing evidence is `visibilityKnown: false` and cannot
satisfy either a visible or a hidden assertion. Geometry does not prove physical
occlusion or pointer hit-testing. Missing AX enabled/focus state carries explicit
unknown flags and cannot satisfy positive or negated assertions for that state.
OS providers retain platform-specific limits;
see their READMEs before choosing a control.

Qt additionally supplies owned-window enumeration/activation, supported model/view
items and the public `ControlAdapter` source extension. Register custom adapters
before `Bridge::start` on the GUI thread and use `qt({ screenshots: false })`;
custom adapters currently disable helper capture. Qt input remains toolkit event
delivery. Native video, visual-diff assertions, arbitrary canvases and embedded
WebEngine/CEF DOM switching are separate unimplemented capabilities.

Secure controls omit their value, text, descendants and arbitrary attributes before
serialization. The OS sidecars intentionally withhold pixels because generic secure
region masking has not been qualified. A stale or destroyed object must fail rather
than redirect an action to a replacement control. Tree limits report truncation;
partial inspection cannot prove that a control is absent.

`NativeEngine`, `NativeDriver` and `NativeTransport` provide runner extension points.
The sidecars separate protocol handling, application lifetime, accessibility providers
and control behavior. Python uses abstract classes, C# interfaces/classes, C++ virtual
adapters, and Rust traits with owned resources. Implement a new provider in a sibling
`native/<platform>/` directory and pass the shared protocol tests; keep platform
branches out of the core scheduler and reporting code.

## Qualification

[RELEASE_STATUS.md](RELEASE_STATUS.md) records what ran in this delivery. A compiled
backend, a fake-provider contract test, an offscreen Qt test, and a live OS accessibility
test are different evidence. None alone establishes every framework/OS combination.
The live scripts in each driver fail when prerequisites are missing; they do not
convert an unavailable graphical session or permission into a pass.

Qualify every advertised toolkit/OS profile using accessible text input, buttons,
check state, selection where supported, disabled controls, password redaction,
stale object behavior, intentional assertion failures, and application cleanup.
Use the platform workflows and retain their artifacts. The rc.3
[`desktop-contracts` run](https://github.com/AhmedAredah/e2e-platform/actions/runs/40429517430)
passed the Linux GTK3 reference-controls acceptance test under D-Bus/Xvfb.
Windows UIA and macOS AX have native build and portable-test evidence, but their
interactive desktop acceptance tests remain unrun. These are prerelease backends;
the Linux reference result does not qualify other toolkits or display sessions.
The bounded C++ authoring bridge is included separately from application drivers.
It shares the runner's lifecycle and reports and supports its documented calls;
it is not full TypeScript API parity. pytest, xUnit and Cargo authoring adapters
are not included. Python, C# and Rust applications use the TypeScript/JavaScript
test API. New Qt OS/kit workflows and the interactive `qt-live` workflow are
qualification plans until their exact candidate runs complete successfully.
