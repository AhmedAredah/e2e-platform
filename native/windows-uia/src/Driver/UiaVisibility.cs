using System.Windows.Automation;
using E2E.Platform.Desktop.Protocol;

namespace E2E.Platform.WindowsUia;

/// <summary>Recompute clipping from owned window and scroll-container ancestors on every read.</summary>
internal static class UiaVisibility
{
    public static ControlVisibility Read(AutomationElement element, int processId)
    {
        static ViewportRect Bounds(AutomationElement current)
        {
            var bounds = current.Current.BoundingRectangle;
            return new(bounds.X, bounds.Y, bounds.Width, bounds.Height);
        }
        var visible = new ViewportVisibility(Bounds(element));
        var seen = new HashSet<string>();
        var current = element;
        for (var depth = 0; current != null && depth < 64; depth++)
        {
            var state = current.Current;
            if (state.ProcessId != processId) return visible.Result;
            if (!seen.Add(string.Join(',', current.GetRuntimeId()))) return ControlVisibility.Unknown;
            if (state.IsOffscreen) return ControlVisibility.Hidden;
            var isWindow = state.ControlType == ControlType.Window;
            if (isWindow || current.TryGetCurrentPattern(ScrollPattern.Pattern, out _))
                visible.Clip(Bounds(current), isWindow);
            if (isWindow) return visible.Result;
            current = TreeWalker.ControlViewWalker.GetParent(current);
        }
        return ControlVisibility.Unknown;
    }
}
