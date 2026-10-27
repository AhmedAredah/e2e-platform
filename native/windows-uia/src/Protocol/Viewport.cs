namespace E2E.Platform.Desktop.Protocol;

public enum ControlVisibility { Unknown, Hidden, Visible }

/// <summary>Semantic viewport bounds, independent of desktop pixels or pointer occlusion.</summary>
public readonly record struct ViewportRect(double X, double Y, double Width, double Height)
{
    public bool Valid => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Width) &&
        double.IsFinite(Height) && Math.Abs(X) <= 1_000_000 && Math.Abs(Y) <= 1_000_000 &&
        Width > 0 && Height > 0 && Width <= 1_000_000 && Height <= 1_000_000;

    public ViewportRect Intersect(ViewportRect other)
    {
        var x = Math.Max(X, other.X);
        var y = Math.Max(Y, other.Y);
        return new(x, y, Math.Min(X + Width, other.X + other.Width) - x,
            Math.Min(Y + Height, other.Y + other.Height) - y);
    }
}

/// <summary>Preserve uncertainty when an ancestor does not expose usable geometry.</summary>
public sealed class ViewportVisibility(ViewportRect bounds)
{
    private ViewportRect visible = bounds;
    private bool unknown = !bounds.Valid;
    private bool hidden;
    private bool window;

    public void Clip(ViewportRect clip, bool isWindow)
    {
        window |= isWindow;
        if (!clip.Valid) { unknown = true; return; }
        if (unknown) return;
        visible = visible.Intersect(clip);
        hidden |= !visible.Valid;
    }

    public ControlVisibility Result => hidden ? ControlVisibility.Hidden :
        unknown || !window ? ControlVisibility.Unknown : ControlVisibility.Visible;
}
