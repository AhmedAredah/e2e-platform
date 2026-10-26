namespace E2E.Platform.Desktop.Protocol;

/// <summary>Conservative pre-serialization budget, including worst-case JSON string escaping.</summary>
public sealed class SnapshotBudget(int maximum = 768 * 1024)
{
    private int remaining = maximum > 0 ? maximum : throw new ArgumentOutOfRangeException(nameof(maximum));
    public bool Truncated { get; private set; }
    public bool TryNode() => Consume(512);
    public string Text(string value, int maximumLength = 65536)
    {
        var bounded = value.Length <= maximumLength ? value : "[omitted: text exceeds limit]";
        if (Consume(checked(bounded.Length * 6))) return bounded;
        const string omitted = "[omitted: snapshot byte limit]";
        return Consume(omitted.Length * 6) ? omitted : "";
    }
    private bool Consume(int bytes)
    {
        if (bytes > remaining) { Truncated = true; return false; }
        remaining -= bytes;
        return true;
    }
}
