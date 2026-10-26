# @e2e-platform/native

An `@e2e-platform/core/engine` plugin for Qt helpers and owned OS accessibility
drivers. Tests remain TypeScript; the application's implementation language is
independent of the selected driver. No AI is required for locator-based tests. `modelPolicy: 'forbid'` blocks the
built-in model path; explicitly supplied custom executors remain trusted project code.

```ts
import { qt } from '@e2e-platform/native';

export default {
  modelPolicy: 'forbid',
  targets: [{
    engine: qt(),
    app: { appPath: './build/my-application', launchArguments: ['--test-profile'] },
  }],
};
```

Include the helper in the application and enable it only in a controlled test
build. It must implement the authenticated [protocol](PROTOCOL.md). This package
does not discover/control arbitrary installed Qt applications. `app.open()`
starts the pinned executable. `app.restart()` starts it again; no state-reset
or back-navigation capability is claimed. Each attempt owns its process tree.

`native(options)` defaults to platform `desktop`; `qt(options)` defaults to
`qt`. Options are `actions`, `keyboard`, `screenshots`, `launchTimeout`,
`requestTimeout`, `maxMessageBytes`, `platform`, and `cwd`. The declared action
subset must be supported by the helper. Defaults: the nine basic Qt actions
listed in the protocol, keyboard/screenshots enabled, a 30-second launch
timeout, a 10-second request timeout, a 16 MiB frame bound, and one worker.
Supply `appPath` and optional `launchArguments`; `app.command`, URL, bundle ID
and permission provisioning are not a native launch interface here.

The layers can be extended by inheritance:

```ts
import { NativeEngine, RpcNativeDriver, type NativeDriver, type NativeTransport } from '@e2e-platform/native';

class ProjectDriver extends RpcNativeDriver {
  // Add explicitly typed project operations, preserving the base contract.
}

class ProjectEngine extends NativeEngine {
  protected override createDriver(transport: NativeTransport): NativeDriver {
    return new ProjectDriver(transport);
  }
}

const engine = new ProjectEngine({ screenshots: false }).handle();
```

`NativeTransport` defines bounded serialized request/close operations;
`JsonRpcTcpTransport` implements loopback JSON-RPC. `NativeDriver` defines
typed application operations; `RpcNativeDriver` validates protocol responses.
`NativeEngine` owns the e2e lifecycle, process supervision, and capabilities.
Override `createTransport`, `createDriver` or `createProcess` rather than duplicating lifecycle
code. Custom drivers are trusted application code and must preserve masking,
actionability, cancellation, and uncertain-mutation rules.

## OS accessibility drivers

`desktop(options)` uses a supplied, locally installed driver executable. It starts
that driver with `--`, the resolved `app.appPath`, and literal `launchArguments`.
The driver launches and owns the application, exposes the authenticated native
protocol, and limits observations/actions to that application's process. It does
not attach to arbitrary existing applications or inspect every desktop window.

```ts
import { desktop } from '@e2e-platform/native';

export default {
  modelPolicy: 'forbid',
  targets: [{
    name: 'linux-desktop',
    engine: desktop({
      backend: 'linux-atspi',
      executable: '/usr/bin/python3',
      args: ['/absolute/e2e-platform/native/linux-atspi/driver.py'],
    }),
    app: {
      appPath: '/absolute/my-application',
      launchArguments: ['--test-profile'],
    },
  }],
};
```

| Backend | Driver implementation and command | Declared semantic actions |
| --- | --- | --- |
| `linux-atspi` | Python: `/usr/bin/python3` with `args: ['/absolute/native/linux-atspi/driver.py']` | tap, fill, clear, focus, check, uncheck, selectOption |
| `windows-uia` | C#: published driver executable, or `dotnet` with `args: ['C:/absolute/E2E.Platform.WindowsUia.dll']` | tap, fill, clear, focus, check, uncheck, selectOption |
| `macos-ax` | Rust: `/absolute/e2e-platform-macos-ax` | tap, fill, clear, focus, check, uncheck |

See each source directory's README for build/install instructions, OS permission
requirements, supported controls, and actual verification status. The npm package
ships the TypeScript engine; it does not bundle these platform runtimes or native
binaries. The complete repository contains the driver source and tests.

The host OS must match the backend; initialization rejects a mismatch before
launch. `executable` may be absolute, relative to `cwd`, or a bare command from the
supplied environment's `PATH`. Driver arguments are literal strings; `--` is
reserved for separating the target command. Neither command is shell-evaluated.
Prefer absolute executable and script/assembly paths in reproducible projects.
`app.appPath` is resolved from the project root, while `cwd` controls the driver
and target working directory. For a Python app set `appPath` to its interpreter
and place the application script in `launchArguments`; for .NET use its apphost,
or the absolute `dotnet` executable followed by the assembly path. Rust/C++ apps
use their compiled executable. The selected toolkit must expose accessible
controls to the selected OS API; language alone does not guarantee coverage.

Optional engine options are `actions` (a nonempty subset), `cwd`, `launchTimeout`,
`requestTimeout`, and `maxMessageBytes`. Unsupported control/pattern combinations
fail explicitly. All three OS profiles disable raw keyboard and screenshots;
semantic `fill` and `tap` are accessibility actions, not physical input. They do
not claim secure global screenshot masking, IME, clipboard, arbitrary drawing,
embedded web content, or OS dialogs outside the owned process. Qt remains the
profile with cooperative masked screenshots and event-based keyboard input.

The engine passes the runner-resolved environment without inheriting additional
ambient variables. Supply the desktop session environment required by the OS
(for example Linux display and D-Bus session variables) through the normal runner
launch environment. Drivers remove the authentication token and port variables
before starting the target. Use an isolated application data/profile directory
when persistent settings can affect tests.

`DesktopEngine extends NativeEngine`, reusing transport, readiness, authentication,
negotiation, restart, cancellation, fault settlement and process supervision.
Custom transports or drivers can still override its inherited factories. New
platform backends should implement their own validated adapter, declare truthful
capabilities, and provide real OS qualification evidence. A mock protocol test
proves lifecycle/transport behavior, not accessibility support on that OS.

`NativeProcessLaunch.options` contains the resolved application command, cwd,
environment and bounded process settings. `options.signal` owns the full
attempt. `context.signal` and `context.timeoutMs` govern factory acquisition;
an asynchronous override must honor those limits, clean up before throwing,
and return its owned `ProcessSession`. If it returns after cancellation or its
deadline, the engine stops and drains that session before cleanup completes.
Trusted overrides that never settle cannot receive a bounded-cleanup guarantee.

Qt event injection tests application event handling. The included Widgets and
Quick adapters cover selected controls; the reference Quick workflow has Linux
offscreen verification. This does not qualify global OS focus/input, native OS
dialogs, WebEngine/CEF/WebView2 or other toolkits. Those capabilities need their
own adapters and validation. Screenshots require source masking. Tests must
provide isolated persistent-data paths when settings/files can influence later
tests. See the protocol for exact bounds.

## Release contract hardening

Locators fail on truncated trees because neither absence nor uniqueness can be proved.
Mutating protocol methods must acknowledge with `null`; malformed acknowledgements fail
as an uncertain action. Cleanup attempts every owned resource even if an extension hook
throws, including a transport acquired before driver construction fails. An already
cancelled restart leaves the current application running. Protocol faults are retained
as attempt failures even after the last successful reply. Bridge disconnects are
reported separately from confirmed process exits.
Unterminated final stdout/stderr lines use the same bounded decoding and redaction path.
Observed names longer than 256 characters and text longer than 512 characters
are omitted whole rather than clipped: the driver does not know registered
secret values, and a prefix could evade the runner's later redaction. Locator
text within the protocol bounds remains complete. The Qt producer similarly
omits oversized or NUL-containing fields before transmission.

Qt selects the global modal or focused window before its toolkit adapter. It discards
screenshots captured across tree or geometry changes and retries a fresh capture at most
twice; persistent instability returns `POLICY_DENIED`. This covers marked secure controls
in the cooperative tree, not arbitrary application copies of secrets in custom painting.

## Development verification

`pnpm --filter @e2e-platform/native test` exercises the transport, parser, engine,
and owned sidecar lifecycle without requiring a graphical session or Python.
For Linux interoperability with the real Python protocol/application host and an
injected deterministic provider, run:

```bash
E2E_TEST_PYTHON=/usr/bin/python3 pnpm --filter @e2e-platform/native test
```

That opt-in suite runs normal TypeScript locators through the Python transport,
checks a planted assertion failure, and verifies target cleanup. It does not
qualify AT-SPI itself. Use `native/linux-atspi/tests/live_smoke.py` in a configured
desktop session for the actual accessibility provider.
