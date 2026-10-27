using System.Text.Json;
using System.Windows.Automation;
using E2E.Platform.Desktop.Protocol;

namespace E2E.Platform.WindowsUia;

/// <summary>Process-scoped UIA Control View. No desktop-wide input or screenshots are permitted.</summary>
public sealed class UiaBackend(int processId) : AccessibilityBackend
{
    private sealed record Entry(string Id, AutomationElement Element, string TestId);
    private readonly Dictionary<string, Entry> byRuntime = [];
    private readonly Dictionary<string, Entry> byId = [];
    private readonly ControlSensitivity sensitive = new();
    private long sequence;
    private readonly ObservedControls lastObserved = new();
    private readonly ControlAdapter[] controls = [new FocusControlAdapter(), new InvokeControlAdapter(), new ValueControlAdapter(), new ToggleControlAdapter(), new SelectionControlAdapter(), new ScrollControlAdapter()];
    public override string Name => "e2e-platform-windows-uia";
    public override IReadOnlyList<string> Actions => ["tap", "fill", "clear", "focus", "check", "uncheck", "selectOption", "scrollIntoView"];
    public override bool SupportsActionability => true;

    public override object Snapshot()
    {
        lastObserved.Invalidate();
        var observed = new HashSet<string>();
        var count = 0;
        var truncated = false;
        var budget = new SnapshotBudget();
        object? Visit(AutomationElement element, int depth)
        {
            if (depth > 63 || ++count > 10000 || !budget.TryNode()) { truncated = true; return null; }
            var current = element.Current;
            if (current.ProcessId != processId) { truncated = true; return null; }
            var runtime = string.Join(',', element.GetRuntimeId());
            if (!observed.Add(runtime)) { truncated = true; return null; }
            if (!byRuntime.TryGetValue(runtime, out var entry) || !IsAlive(entry.Element))
            {
                if (entry != null) { byId.Remove(entry.Id); sensitive.Forget(entry.Id); }
                if (byId.Count >= 20000) throw new DriverException("ENGINE_FAILURE");
                entry = new Entry("uia-" + ++sequence, element, Bounded(current.AutomationId, 1024));
                byRuntime[runtime] = entry;
                byId[entry.Id] = entry;
            }
            var secure = sensitive.Observe(entry.Id, current.IsPassword);
            var states = new Dictionary<string, bool> {
                ["disabled"] = !current.IsEnabled, ["hidden"] = current.IsOffscreen,
                ["focused"] = current.HasKeyboardFocus, ["secure"] = secure
            };
            var node = new Dictionary<string, object?> {
                ["ref"] = new { id = entry.Id, revision = "" }, ["role"] = ControlSemantics.Role(current.ControlType.Id, element.TryGetCurrentPattern(GridItemPattern.Pattern, out _)),
                ["name"] = secure ? "" : budget.Text(current.Name), ["states"] = states
            };
            if (!string.IsNullOrEmpty(entry.TestId)) node["testId"] = budget.Text(entry.TestId, 1024);
            if (secure) { node["inputPurpose"] = current.IsPassword ? "password" : "generic-secret"; return node; }
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle))
            {
                var state = ((TogglePattern)toggle).Current.ToggleState;
                if (state != ToggleState.Indeterminate) states["checked"] = state == ToggleState.On;
            }
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selected))
            {
                states["selected"] = ((SelectionItemPattern)selected).Current.IsSelected;
                if (current.ControlType == ControlType.RadioButton) states["checked"] = states["selected"];
            }
            if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var expanded))
                states["expanded"] = ((ExpandCollapsePattern)expanded).Current.ExpandCollapseState == ExpandCollapseState.Expanded;
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var value)) node["value"] = budget.Text(((ValuePattern)value).Current.Value);
            else if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out var range)) node["value"] = budget.Text(ControlSemantics.NumericValue(((RangeValuePattern)range).Current.Value));
            else if (current.ControlType == ControlType.Text) node["text"] = budget.Text(current.Name);
            var children = new List<object>();
            for (var child = TreeWalker.ControlViewWalker.GetFirstChild(element); child != null; child = TreeWalker.ControlViewWalker.GetNextSibling(child))
            {
                if (count >= 10000) { truncated = true; break; }
                var built = Visit(child, depth + 1);
                if (built != null) children.Add(built);
            }
            if (children.Count > 0) node["children"] = children;
            return node;
        }
        try
        {
            var windows = new List<object>();
            var scanned = 0;
            for (var window = TreeWalker.ControlViewWalker.GetFirstChild(AutomationElement.RootElement); window != null; window = TreeWalker.ControlViewWalker.GetNextSibling(window))
            {
                if (++scanned > 10000) { truncated = true; break; }
                if (window.Current.ProcessId != processId) continue;
                var built = Visit(window, 1);
                if (built != null) windows.Add(built);
            }
            foreach (var key in byRuntime.Keys.Where(key => !observed.Contains(key) && !IsAlive(byRuntime[key].Element)).ToArray())
            {
                byId.Remove(byRuntime[key].Id); sensitive.Forget(byRuntime[key].Id); byRuntime.Remove(key);
            }
            lastObserved.Complete(observed.Select(key => byRuntime[key].Id));
            // Geometry is deliberately absent: this backend promises semantic control only.
            return new { root = new { @ref = new { id = "desktop-root", revision = "" }, role = "application", name = "Owned application", children = windows }, viewport = new { width = 1, height = 1 }, truncated = truncated || budget.Truncated };
        }
        catch (ElementNotAvailableException) { throw new DriverException("NODE_STALE"); }
    }

    public override void Actionability(string id, JsonElement action) => PrepareAction(id, action, false);
    public override void Perform(string id, JsonElement action) => PrepareAction(id, action, true);

    private void PrepareAction(string id, JsonElement action, bool execute)
    {
        if (!lastObserved.Contains(id) || !byId.TryGetValue(id, out var entry)) throw new DriverException("NODE_STALE");
        try
        {
            var current = entry.Element.Current;
            if (current.ProcessId != processId) throw new DriverException("NODE_STALE");
            var kind = RequestValidator.String(action, "kind");
            if (!current.IsEnabled || (kind != "scrollIntoView" && current.IsOffscreen)) throw new DriverException("NOT_ACTIONABLE");
            var adapter = controls.SingleOrDefault(control => control.Supports(kind)) ?? throw new DriverException("UNSUPPORTED_CAPABILITY");
            var mutation = new MutationGuard();
            var prepared = adapter.Prepare(entry.Element, kind, action, mutation);
            if (execute)
            {
                if (kind == "fill" && action.TryGetProperty("sensitive", out var secret) && secret.GetBoolean()) sensitive.Observe(id, true);
                mutation.Run(prepared);
            }
        }
        catch (ElementNotAvailableException) { throw new DriverException("NODE_STALE"); }
        catch (ElementNotEnabledException) { throw new DriverException("NOT_ACTIONABLE"); }
        catch (DriverException) { throw; }
        catch { throw new DriverException("ENGINE_FAILURE"); }
    }

    private bool IsAlive(AutomationElement element)
    {
        try { return element.Current.ProcessId == processId; }
        catch (ElementNotAvailableException) { return false; }
    }
    private static string Bounded(string value, int maximum = 65536) => value.Length <= maximum ? value : "[omitted: text exceeds limit]";
    public override void Dispose() { byId.Clear(); byRuntime.Clear(); sensitive.Clear(); lastObserved.Invalidate(); }
}
