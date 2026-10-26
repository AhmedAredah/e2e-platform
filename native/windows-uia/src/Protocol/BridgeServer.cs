using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>A single bounded loopback connection; loss of the connection ends ownership.</summary>
public sealed class BridgeServer : IDisposable
{
    public const int MaximumFrameBytes = 1024 * 1024;
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly AccessibilityBackend backend;
    private readonly string token;

    public BridgeServer(AccessibilityBackend backend, string token)
    {
        if (token.Length != 64 || token.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Invalid native authentication token");
        this.backend = backend;
        this.token = token;
    }

    public int Start()
    {
        listener.Start(1);
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var acquisition = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        acquisition.CancelAfter(TimeSpan.FromSeconds(30));
        using var client = await listener.AcceptTcpClientAsync(acquisition.Token);
        listener.Stop();
        client.NoDelay = true;
        using var stream = client.GetStream();
        var session = new BridgeSession(backend, token);
        var buffer = new byte[MaximumFrameBytes];
        var length = 0;
        var frameDeadline = DateTime.UtcNow.AddSeconds(15);
        while (!session.CloseRequested)
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var remaining = frameDeadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero) throw new DriverException("OPERATION_TIMEOUT");
            deadline.CancelAfter(remaining);
            var read = await stream.ReadAsync(buffer.AsMemory(length, buffer.Length - length), deadline.Token);
            if (read == 0) return;
            length += read;
            while (Array.IndexOf(buffer, (byte)'\n', 0, length) is var newline && newline >= 0)
            {
                using var document = JsonDocument.Parse(buffer.AsMemory(0, newline), new JsonDocumentOptions { MaxDepth = 80 });
                var request = document.RootElement.Clone();
                object reply;
                try
                {
                    // UIA provider code is outside our trust boundary and can hang.
                    reply = await Task.Run(() => session.Dispatch(request), CancellationToken.None)
                        .WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
                }
                catch (TimeoutException)
                {
                    var id = request.TryGetProperty("id", out var value) && value.TryGetInt64(out var number) ? number : 0;
                    var mutation = request.TryGetProperty("method", out var method) && method.GetString() == "perform";
                    reply = BridgeSession.Error(id, mutation ? "ACTION_MAY_HAVE_COMMITTED" : "OPERATION_TIMEOUT");
                    await WriteAsync(stream, reply, cancellationToken);
                    return;
                }
                await WriteAsync(stream, reply, cancellationToken);
                length -= newline + 1;
                Buffer.BlockCopy(buffer, newline + 1, buffer, 0, length);
                if (session.CloseRequested) return;
                frameDeadline = DateTime.UtcNow.AddSeconds(session.Authenticated ? 300 : 15);
            }
            if (length == buffer.Length) throw new DriverException("ENGINE_FAILURE");
        }
    }

    private static async Task WriteAsync(NetworkStream stream, object reply, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(reply);
        if (bytes.Length >= MaximumFrameBytes) throw new DriverException("ENGINE_FAILURE");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        await stream.WriteAsync(bytes, deadline.Token);
        await stream.WriteAsync(new byte[] { 10 }, deadline.Token);
    }

    public void Dispose() => listener.Stop();
}
