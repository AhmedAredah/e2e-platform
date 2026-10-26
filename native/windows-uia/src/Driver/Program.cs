using E2E.Platform.Desktop.Protocol;
using E2E.Platform.WindowsUia;

if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("Windows UIA requires Windows and an interactive desktop."); return 2; }
if (args.Length < 2 || args[0] != "--") { Console.Error.WriteLine("Usage: E2E.Platform.WindowsUia -- <absolute-executable> [arguments...]"); return 2; }
var token = Environment.GetEnvironmentVariable("E2E_NATIVE_TOKEN") ?? "";
if (token.Length != 64 || token.Any(c => !Uri.IsHexDigit(c))) { Console.Error.WriteLine("A 64-character native token is required."); return 2; }
using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
try
{
    using var child = new OwnedWindowsProcess(args[1], args[2..]);
    using var backend = new UiaBackend(child.Id);
    using var server = new BridgeServer(backend, token);
    var port = server.Start();
    Console.WriteLine("E2E_NATIVE_READY " + System.Text.Json.JsonSerializer.Serialize(new { port }));
    Console.Out.Flush();
    var session = server.RunAsync(cancellation.Token);
    while (!session.IsCompleted)
    {
        await Task.WhenAny(session, Task.Delay(100, cancellation.Token));
        if (child.HasExited) { cancellation.Cancel(); throw new DriverException("ENGINE_FAILURE"); }
    }
    await session;
    return 0;
}
catch (OperationCanceledException) { return cancellation.IsCancellationRequested ? 0 : 2; }
catch { Console.Error.WriteLine("Windows UIA driver failed; no application or authentication data is logged."); return 2; }
