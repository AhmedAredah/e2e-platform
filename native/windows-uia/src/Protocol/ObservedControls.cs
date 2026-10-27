namespace E2E.Platform.Desktop.Protocol;

/// <summary>A failed observation cannot leave old node references authorized for mutation.</summary>
public sealed class ObservedControls
{
    private HashSet<string> ids = [];

    public void Invalidate() => ids.Clear();
    public void Complete(IEnumerable<string> observed) => ids = observed.ToHashSet(StringComparer.Ordinal);
    public bool Contains(string id) => ids.Contains(id);
}
