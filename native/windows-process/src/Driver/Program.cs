using E2E.Platform.WindowsProcess;
using E2E.Platform.WindowsProcess.Protocol;

var events = new EventWriter(Console.OpenStandardOutput());
events.Start();
try
{
    var requests = new FrameReader(Console.OpenStandardInput());
    using var firstRequestDeadline = new CancellationTokenSource(30000);
    var launch = (await requests.ReadAsync(firstRequestDeadline.Token))?.Launch ?? throw new ProtocolException("INVALID_REQUEST");
    using var parent = new ParentProcess(launch.ParentPid);
    using var process = new OwnedJobProcess(launch);
    return await new Supervisor(requests, events, process, parent).RunAsync(launch);
}
catch (Exception error)
{
    var code = error is ProtocolException known ? known.Code : "LAUNCH_FAILED";
    try
    {
        using var reporting = new CancellationTokenSource(1000);
        await events.SendAsync(Supervisor.Error(code), reporting.Token);
        events.Complete();
        await events.Completion.WaitAsync(reporting.Token);
    }
    catch { /* Diagnostics never include executable names, arguments, environment, or exception text. */ }
    return 1;
}
