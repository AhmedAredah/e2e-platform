namespace E2E.Platform.Desktop.Protocol;

/// <summary>Security classification is monotonic for one retained control identity.</summary>
public sealed class ControlSensitivity
{
    private readonly HashSet<string> sensitive = new(StringComparer.Ordinal);

    public bool Observe(string id, bool detected)
    {
        if (detected) sensitive.Add(id);
        return sensitive.Contains(id);
    }

    public void Forget(string id) => sensitive.Remove(id);
    public void Clear() => sensitive.Clear();
}
