using System.Text.Json;
using System.Threading.Channels;

namespace E2E.Platform.WindowsProcess;

/// <summary>One output writer and a fixed queue bound the memory used when the controller stops reading.</summary>
internal sealed class EventWriter(Stream output)
{
    private readonly Channel<object> queue = Channel.CreateBounded<object>(new BoundedChannelOptions(8)
    {
        FullMode = BoundedChannelFullMode.Wait, SingleReader = true, SingleWriter = false
    });
    public Task Completion { get; private set; } = Task.CompletedTask;
    public void Start() => Completion = PumpAsync();
    public ValueTask SendAsync(object message, CancellationToken cancellationToken = default) => queue.Writer.WriteAsync(message, cancellationToken);
    public void Complete() => queue.Writer.TryComplete();
    private async Task PumpAsync()
    {
        try
        {
            await foreach (var message in queue.Reader.ReadAllAsync())
            {
                var frame = JsonSerializer.SerializeToUtf8Bytes(message);
                await output.WriteAsync(frame);
                await output.WriteAsync(new byte[] { 10 });
                await output.FlushAsync();
            }
        }
        catch (Exception error) { queue.Writer.TryComplete(error); throw; }
    }
}
