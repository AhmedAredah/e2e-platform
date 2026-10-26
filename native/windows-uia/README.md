# Windows UI Automation driver

A C#/.NET 10 native-bridge-v1 sidecar for applications that expose Windows UI
Automation providers. This is a real UIA implementation, independent of the
application's programming language. Its first acceptance fixture is WPF. Other
frameworks (WinForms, WinUI, Qt, Avalonia, Python toolkits and Rust toolkits) must
be qualified separately on their actual Windows versions and UIA providers.

**Status:** experimental. The driver and WPF fixture cross-compile on Linux;
portable protocol tests run on Linux. Windows GUI behavior is not verified by
those results. Run the live acceptance procedure on an interactive Windows
desktop before claiming that platform is supported. Session 0, the lock screen,
UAC secure desktops, elevated targets and remote/reused applications are outside
this implementation's supported scope.

## Build and use

Use a Windows .NET 10 SDK (or install the WindowsDesktop targeting pack for
cross-compilation). There are no external NuGet library dependencies.

```powershell
dotnet build native/windows-uia/src/Driver/E2E.Platform.WindowsUia.csproj -c Release
# Optionally produce a self-contained Windows x64 distribution:
dotnet publish native/windows-uia/src/Driver/E2E.Platform.WindowsUia.csproj -c Release -r win-x64 --self-contained true -o native/windows-uia/build/publish/win-x64
```

The shared TypeScript `desktop` engine launches the driver, creates a fresh
`E2E_NATIVE_TOKEN`, and passes `--`, the application's absolute executable path,
and its argument vector. The compiled driver can also be started as
`dotnet /absolute/E2E.Platform.WindowsUia.dll -- C:\\absolute\\App.exe` while
providing the protocol token. A shell is never used. Run the apphost executable
when using the accompanying Python live verifier.

The target starts suspended, joins a kill-on-close Windows Job Object, then
resumes. This prevents target execution before ownership is established. The
helper removes `E2E_NATIVE_TOKEN` and `E2E_NATIVE_PORT` from the application's
environment. Closing the helper's authenticated connection or sending shutdown terminates
the job, verifies that its active-process count reaches zero, and closes its
handle. Terminating the helper closes the kill-on-close job automatically.
If the app exits before shutdown, the helper fails. UIA discovery is restricted
to the directly launched PID; child-process windows are not merged into its tree.

## Controls and limits

| Operation | Required UIA support |
| --- | --- |
| `tap` | InvokePattern, or SelectionItemPattern |
| `fill`, `clear` | Writable ValuePattern |
| `focus` | Keyboard-focusable element |
| `check`, `uncheck` | TogglePattern; check also supports radio SelectionItemPattern |
| `selectOption` | SelectionPattern plus matching descendant SelectionItemPattern |

`selectOption` accepts an exact label string, `{label}`, a child AutomationId
via `{value}`, or an index in the currently realized option list. Virtualized
unrealized options require a future realization adapter; they are not silently
selected by an index. Combo boxes may be expanded to expose their options.
Failures after expansion report an uncertain mutation outcome. Unchecking a
selected radio is unsupported unless its provider exposes TogglePattern.
Toggle transitions are observed before any next transition, and an uncertain
transition is never replayed.

Control roles, accessible names, AutomationIds, values and states come from
UIA Control View. Provider-supplied initial AutomationIds are trusted metadata
and are frozen for each retained element. Password fields and fields filled
with `sensitive:true` have no name, value, text, attributes or children in a
snapshot. Their test IDs remain usable. Sensitive state survives temporary
absence from the observed tree and later changes to the provider's password
flag, including reveal-password controls. Provider labels elsewhere in the application
are the application's responsibility; a malicious provider is not a sandbox.
Selection containers do not copy selected descendants' text into their own
value, avoiding a second route for sensitive content.

The synthetic root uses a 1×1 semantic viewport. There are no pixel rectangles,
keyboard injection, screenshot capture, coordinate clicks, clipboard, IME,
drag/drop or WebView DOM contexts. Both `keyboard` and `screenshots` are false.
Unsupported actions fail explicitly. Set capability lists to the implemented
subset; the driver does not advertise nonexistent general input support.

The tree is limited to 10,000 nodes and depth 63, with a conservative 768 KiB
aggregate allocation budget before serialization (including JSON escaping). Incomplete trees carry
`truncated:true`; the shared engine refuses completeness-dependent lookup.
The registry retains at most 20,000 live identities and never reassigns an
issued ID to a later registry entry. UIA runtime IDs are opaque, may be recycled
by providers, and retained proxies are checked for availability. Actions require
an ID present in the latest successful snapshot. A hung UIA operation gets a
10-second budget, then the connection and owned process end; an interrupted
mutation is reported as `ACTION_MAY_HAVE_COMMITTED`.

Protocol frames are capped at 1 MiB, JSON nesting at 80, authentication at 15
seconds, connection acquisition at 30 seconds, and each idle/partial frame at
five minutes after authentication. Request IDs must increase, unknown/duplicate
fields are rejected, and tokens and application data are never emitted in
helper diagnostics. Screenshots remain disabled until secure capture is
implemented and separately verified.

## Validation

Portable tests (including a real loopback TCP connection):

```powershell
dotnet run --project native/windows-uia/tests/ProtocolTests/E2E.Platform.Desktop.Protocol.Tests.csproj -c Release
```

Windows-only acceptance with the real WPF fixture:

```powershell
dotnet build examples/with-desktop/dotnet/AccessibleDemo.csproj -c Release
python native/windows-uia/tests/live_smoke.py --driver native/windows-uia/build/bin/E2E.Platform.WindowsUia/Release/net10.0-windows/E2E.Platform.WindowsUia.exe --app examples/with-desktop/dotnet/build/bin/Release/net10.0-windows/AccessibleDemo.exe
```

The live verifier fails on a non-Windows host. It tests actual UIA controls,
rejects a deliberately wrong result, verifies secret exclusion, and requires
application cleanup. A CI configuration is not a passing Windows result.

## Extension structure and references

`src/Protocol` contains the portable authenticated session/server and abstract
`AccessibilityBackend`. `src/Driver` implements `UiaBackend`, concrete
`ControlAdapter` subclasses and `OwnedWindowsProcess`. Add future UIA patterns
through control adapters; keep platform process ownership separate from UIA.
The driver uses only .NET/Windows APIs and retains the repository's MIT license;
.NET/Windows runtime redistribution remains subject to its own license.

Official API references:

- [UI Automation overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)
- [UIA threading](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-threading-issues)
- [Runtime ID lifetime](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getruntimeid)
- [ValuePattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue)
- [SelectionItemPattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.selectionitempattern.select)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
