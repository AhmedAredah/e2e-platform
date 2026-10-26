# Accessible WPF application

This application exposes ordinary WPF UI Automation peers; it embeds no testing
bridge. `AutomationProperties.Name` supplies user-facing names and
`AutomationProperties.AutomationId` supplies stable test IDs. The same Windows
UIA driver can inspect other languages' applications when they expose compatible
UIA patterns.

On Windows with an interactive, unlocked desktop and the .NET 10 SDK:

```powershell
dotnet build examples/with-desktop/dotnet/AccessibleDemo.csproj -c Release
dotnet build native/windows-uia/src/Driver/E2E.Platform.WindowsUia.csproj -c Release
python native/windows-uia/tests/live_smoke.py --driver native/windows-uia/build/bin/E2E.Platform.WindowsUia/Release/net10.0-windows/E2E.Platform.WindowsUia.exe --app examples/with-desktop/dotnet/build/bin/Release/net10.0-windows/AccessibleDemo.exe
```

The verifier checks value changes, invocation, checked state, selection,
read-only/disabled refusals, stale references, password exclusion, target token
isolation and parent/descendant process cleanup. It runs a second application with `--planted-bug`
and requires the wrong output to be detected. This is a platform qualification
procedure, not evidence that it has already run on Windows.
