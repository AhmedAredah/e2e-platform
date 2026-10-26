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
    private readonly HashSet<string> sensitive = [];
    private long sequence;
    private HashSet<string> lastObserved = [];
    private readonly ControlAdapter[] controls = [new FocusControlAdapter(), new InvokeControlAdapter(), new ValueControlAdapter(), new ToggleControlAdapter(), new SelectionControlAdapter()];
    public override string Name => "e2e-platform-windows-uia";
    public override IReadOnlyList<string> Actions => ["tap", "fill", "clear", "focus", "check", "uncheck", "selectOption"];

    public override object Snapshot()
    {
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
                if (entry != null) { byId.Remove(entry.Id); sensitive.Remove(entry.Id); }
                if (byId.Count >= 20000) throw new DriverException("ENGINE_FAILURE");
                entry = new Entry("uia-" + ++sequence, element, Bounded(current.AutomationId, 1024));
                byRuntime[runtime] = entry;
                byId[entry.Id] = entry;
            }
            var secure = current.IsPassword || sensitive.Contains(entry.Id);
            var states = new Dictionary<string, bool> {
                ["disabled"] = !current.IsEnabled, ["hidden"] = current.IsOffscreen,
                ["focused"] = current.HasKeyboardFocus, ["secure"] = secure
            };
            var node = new Dictionary<string, object?> {
                ["ref"] = new { id = entry.Id, revision = "" }, ["role"] = Role(current.ControlType),
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
            lastObserved = observed.Select(key => byRuntime[key].Id).ToHashSet(StringComparer.Ordinal);
            foreach (var key in byRuntime.Keys.Where(key => !observed.Contains(key) && !IsAlive(byRuntime[key].Element)).ToArray())
            {
                byId.Remove(byRuntime[key].Id); sensitive.Remove(byRuntime[key].Id); byRuntime.Remove(key);
            }
            // Geometry is deliberately absent: this backend promises semantic control only.
            return new { root = new { @ref = new { id = "desktop-root", revision = "" }, role = "application", name = "Owned application", children = windows }, viewport = new { width = 1, height = 1 }, truncated = truncated || budget.Truncated };
        }
        catch (ElementNotAvailableException) { throw new DriverException("NODE_STALE"); }
    }

    public override void Perform(string id, JsonElement action)
    {
        if (!lastObserved.Contains(id) || !byId.TryGetValue(id, out var entry)) throw new DriverException("NODE_STALE");
        var entered = false;
        try
        {
            var current = entry.Element.Current;
            if (current.ProcessId != processId) throw new DriverException("NODE_STALE");
            if (!current.IsEnabled || current.IsOffscreen) throw new DriverException("NOT_ACTIONABLE");
            var kind = RequestValidator.String(action, "kind");
            if (kind == "fill" && action.TryGetProperty("sensitive", out var secret) && secret.GetBoolean()) sensitive.Add(id);
            var adapter = controls.SingleOrDefault(control => control.Supports(kind)) ?? throw new DriverException("UNSUPPORTED_CAPABILITY");
            entered = true;
            adapter.Perform(entry.Element, kind, action);
        }
        catch (ElementNotAvailableException) { throw new DriverException(entered ? "ACTION_MAY_HAVE_COMMITTED" : "NODE_STALE"); }
        catch (ElementNotEnabledException) { throw new DriverException(entered ? "ACTION_MAY_HAVE_COMMITTED" : "NOT_ACTIONABLE"); }
        catch (DriverException) { throw; }
        catch { throw new DriverException("ACTION_MAY_HAVE_COMMITTED"); }
    }

    private bool IsAlive(AutomationElement element)
    {
        try { return element.Current.ProcessId == processId; }
        catch (ElementNotAvailableException) { return false; }
    }
    private static string Bounded(string value, int maximum = 65536) => value.Length <= maximum ? value : "[omitted: text exceeds limit]";
    private static string Role(ControlType type) => type.Id switch {
        50000 => "button", 50002 => "checkbox", 50003 => "combobox", 50004 => "textbox",
        50005 => "link", 50006 => "img", 50007 => "listitem", 50008 => "list", 50009 => "menu",
        50010 => "menubar", 50011 => "menuitem", 50012 => "progressbar", 50013 => "radio",
        50014 => "scrollbar", 50015 => "slider", 50016 => "spinbutton", 50018 => "tablist",
        50019 => "tab", 50020 => "text", 50021 => "toolbar", 50022 => "tooltip",
        50023 => "tree", 50024 => "treeitem", 50026 => "group", 50028 => "grid",
        50029 => "row", 50030 => "document", 50032 => "window", 50036 => "table",
        _ => "group"
    };
    public override void Dispose() { byId.Clear(); byRuntime.Clear(); sensitive.Clear(); lastObserved.Clear(); }
}
