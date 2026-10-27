namespace E2E.Platform.WindowsProcess.Protocol;

/// <summary>UTF-8 JSON lines with a fixed buffer and no unbounded ReadLine allocation.</summary>
public sealed class FrameReader(Stream input)
{
    private readonly byte[] buffer = new byte[RequestParser.MaximumFrameBytes + 1];
    private int used;
    private readonly RequestParser parser = new();

    public async Task<Request?> ReadAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            var newline = Array.IndexOf(buffer, (byte)'\n', 0, used);
            if (newline >= 0)
            {
                var request = parser.Parse(buffer.AsMemory(0, newline));
                used -= newline + 1;
                Buffer.BlockCopy(buffer, newline + 1, buffer, 0, used);
                return request;
            }
            if (used == buffer.Length) throw new ProtocolException("INVALID_REQUEST");
            var read = await input.ReadAsync(buffer.AsMemory(used), cancellationToken);
            if (read == 0)
            {
                if (used != 0) throw new ProtocolException("INVALID_REQUEST");
                return null;
            }
            used += read;
        }
    }
}
