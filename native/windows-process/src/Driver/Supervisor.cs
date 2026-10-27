using E2E.Platform.WindowsProcess.Protocol;

namespace E2E.Platform.WindowsProcess;

internal sealed class Supervisor(FrameReader requests, EventWriter events, OwnedJobProcess process, ParentProcess parent)
{
    private readonly CancellationTokenSource finished = new();
    private readonly TaskCompletionSource failureSignal = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private string? failure;
    private int stopped;
    private Task inputWrite = Task.CompletedTask;
    private Task inputCloseAck = Task.CompletedTask;
    private bool inputClosed;

    public async Task<int> RunAsync(LaunchSpec launch)
    {
        // This first enqueue cannot block: the bounded queue is empty before any producer starts.
        await events.SendAsync(new { kind = "started", id = 1, pid = process.Id });
        var parentWatch = WatchParentAsync();
        var controls = ReadControlsAsync();
        // Output failure must stop the job even when the target is blocked on a full pipe.
        _ = events.Completion.ContinueWith(_ => { if (!finished.IsCancellationRequested) Fail("IO_FAILED"); }, CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        var stdout = PumpAsync(process.Output, "stdout");
        var stderr = PumpAsync(process.Error, "stderr");
        var rootExit = process.WaitForExitAsync(finished.Token);
        try
        {
            if (await Task.WhenAny(rootExit, failureSignal.Task) == failureSignal.Task)
                throw new ProtocolException(failure ?? "IO_FAILED");
            var code = await rootExit;
            // Cleanup cannot be held hostage by protocol output backpressure.
            process.Terminate();
            // Zero means no waiting for application streams, not a race with a zero-duration timer.
            if (launch.DrainTimeoutMs == 0 && (!stdout.IsCompleted || !stderr.IsCompleted || !inputWrite.IsCompleted || !inputCloseAck.IsCompleted))
                throw new ProtocolException("IO_FAILED");
            using var drain = new CancellationTokenSource(launch.DrainTimeoutMs == 0 ? 1000 : launch.DrainTimeoutMs);
            // Report the root transition while verification proceeds, so the runner can end its runtime timer.
            await Task.WhenAll(process.VerifyEmptyAsync(),
                events.SendAsync(new { kind = "rootExit", exitCode = code }, drain.Token).AsTask());
            await Task.WhenAll(stdout, stderr).WaitAsync(drain.Token);
            await inputWrite.WaitAsync(drain.Token);
            await inputCloseAck.WaitAsync(drain.Token);
            finished.Cancel();
            if (failure is null)
                await events.SendAsync(new { kind = "exit", exitCode = code, stopped = Volatile.Read(ref stopped) != 0, cleanup = true }, drain.Token);
            else await events.SendAsync(Error(failure), drain.Token);
            events.Complete();
            await events.Completion.WaitAsync(drain.Token);
            return failure is null ? 0 : 1;
        }
        catch (ProtocolException error) { Fail(error.Code); }
        catch { Fail("IO_FAILED"); }
        finally
        {
            finished.Cancel();
            try { await rootExit; } catch { }
            // Parent polling never blocks in native code, so finish it before disposing its process handle.
            await parentWatch;
            // Console stdin cancellation is runtime dependent. A late read checks finished before touching handles.
            try { await controls.WaitAsync(TimeSpan.FromMilliseconds(250)); }
            catch (TimeoutException) { }
        }
        try { process.Terminate(); await process.VerifyEmptyAsync(); }
        catch { Interlocked.Exchange(ref failure, "CLEANUP_FAILED"); }
        try
        {
            using var reporting = new CancellationTokenSource(1000);
            await events.SendAsync(Error(failure ?? "IO_FAILED"), reporting.Token);
            events.Complete();
            await events.Completion.WaitAsync(reporting.Token);
        }
        catch { /* The controller may have closed its output pipe. Cleanup still precedes exit. */ }
        return 1;
    }

    private async Task PumpAsync(Stream stream, string name)
    {
        try
        {
            var buffer = new byte[16 * 1024];
            while (true)
            {
                var count = await stream.ReadAsync(buffer, finished.Token);
                if (count == 0) return;
                await events.SendAsync(new { kind = "output", stream = name, data = Convert.ToBase64String(buffer, 0, count) }, finished.Token);
            }
        }
        catch (OperationCanceledException) when (finished.IsCancellationRequested) { }
        catch { if (!finished.IsCancellationRequested) Fail("IO_FAILED"); }
    }

    private async Task ReadControlsAsync()
    {
        try
        {
            while (!finished.IsCancellationRequested)
            {
                var request = await requests.ReadAsync(finished.Token);
                if (finished.IsCancellationRequested) return;
                if (request is null) { Stop(); return; }
                switch (request.Kind)
                {
                    case "stdin":
                        if (!inputWrite.IsCompleted) throw new ProtocolException("INVALID_REQUEST");
                        if (inputClosed || Volatile.Read(ref stopped) != 0) throw new ProtocolException("STDIN_CLOSED");
                        // Do not block the reader: stop must interrupt a target that never reads stdin.
                        inputWrite = WriteInputAsync(request);
                        break;
                    case "eof":
                        if (!inputWrite.IsCompleted) throw new ProtocolException("INVALID_REQUEST");
                        if (inputClosed) throw new ProtocolException("STDIN_CLOSED");
                        inputClosed = true;
                        process.Input.Dispose();
                        // There can be only one EOF. Keep stop readable while its ack is backpressured.
                        inputCloseAck = events.SendAsync(new { kind = "ack", id = request.Id }, finished.Token).AsTask();
                        break;
                    case "stop":
                        Stop();
                        await events.SendAsync(new { kind = "ack", id = request.Id }, finished.Token);
                        break;
                    default: throw new ProtocolException("INVALID_REQUEST");
                }
            }
        }
        catch (OperationCanceledException) when (finished.IsCancellationRequested) { }
        catch (ProtocolException error) { if (!finished.IsCancellationRequested) Fail(error.Code); }
        catch { if (!finished.IsCancellationRequested) Fail("IO_FAILED"); }
    }

    private async Task WriteInputAsync(Request request)
    {
        try
        {
            await process.Input.WriteAsync(request.Data!, finished.Token);
            await process.Input.FlushAsync(finished.Token);
            await events.SendAsync(new { kind = "ack", id = request.Id }, finished.Token);
        }
        catch
        {
            // Exit/stop is also a terminal result for an in-flight input request.
            if (!finished.IsCancellationRequested && Volatile.Read(ref stopped) == 0 && !process.HasExited) Fail("STDIN_CLOSED");
        }
    }

    private async Task WatchParentAsync()
    {
        try
        {
            while (!finished.IsCancellationRequested)
            {
                if (parent.HasExited) { Stop(); return; }
                await Task.Delay(25, finished.Token);
            }
        }
        catch (OperationCanceledException) when (finished.IsCancellationRequested) { }
        catch { if (!finished.IsCancellationRequested) Fail("IO_FAILED"); }
    }

    private void Stop()
    {
        Interlocked.Exchange(ref stopped, 1);
        process.Terminate();
    }
    private void Fail(string code)
    {
        Interlocked.CompareExchange(ref failure, code, null);
        try { Stop(); } catch { Interlocked.Exchange(ref failure, "CLEANUP_FAILED"); }
        failureSignal.TrySetResult();
    }
    internal static object Error(string code) => new { kind = "error", code, message = code switch
    {
        "INVALID_REQUEST" => "Invalid supervisor request.",
        "LAUNCH_FAILED" => "The owned process could not be started.",
        "STDIN_CLOSED" => "The process input is closed.",
        "CLEANUP_FAILED" => "Process cleanup could not be verified.",
        _ => "Process transport failed."
    } };
}
