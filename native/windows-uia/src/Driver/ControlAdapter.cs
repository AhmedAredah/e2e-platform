using System.Text.Json;
using System.Windows.Automation;
using E2E.Platform.Desktop.Protocol;

namespace E2E.Platform.WindowsUia;

/// <summary>Extend control behavior through UIA patterns, independent of the app's source language.</summary>
public abstract class ControlAdapter
{
    public abstract bool Supports(string kind);
    /// <summary>Validate without mutating; only invoking the returned operation may dispatch input.</summary>
    public abstract Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation);
    protected static T Pattern<T>(AutomationElement element, AutomationPattern pattern) where T : BasePattern =>
        element.TryGetCurrentPattern(pattern, out var value) && value is T typed
            ? typed : throw new DriverException("UNSUPPORTED_CAPABILITY");
}

public sealed class FocusControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind == "focus";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        if (!element.Current.IsKeyboardFocusable) throw new DriverException("NOT_ACTIONABLE");
        return () => mutation.Dispatch(element.SetFocus);
    }
}

public sealed class InvokeControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind == "tap";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke)) return () => mutation.Dispatch(((InvokePattern)invoke).Invoke);
        else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selection)) return () => mutation.Dispatch(((SelectionItemPattern)selection).Select);
        else throw new DriverException("UNSUPPORTED_CAPABILITY");
    }
}

public sealed class ValueControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind is "fill" or "clear";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        var value = Pattern<ValuePattern>(element, ValuePattern.Pattern);
        if (value.Current.IsReadOnly) throw new DriverException("NOT_ACTIONABLE");
        var text = kind == "clear" ? "" : RequestValidator.String(action, "value");
        return () => mutation.Dispatch(() => value.SetValue(text));
    }
}

public sealed class ToggleControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind is "check" or "uncheck";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out var rawToggle))
        {
            if (element.Current.ControlType != ControlType.RadioButton) throw new DriverException("UNSUPPORTED_CAPABILITY");
            var selected = Pattern<SelectionItemPattern>(element, SelectionItemPattern.Pattern);
            if (kind == "uncheck" && selected.Current.IsSelected) throw new DriverException("UNSUPPORTED_CAPABILITY");
            return () =>
            {
                if (kind == "check" && !selected.Current.IsSelected) mutation.Dispatch(selected.Select);
                else if (kind == "uncheck" && selected.Current.IsSelected) throw new DriverException("UNSUPPORTED_CAPABILITY");
            };
        }
        var toggle = (TogglePattern)rawToggle;
        var expected = kind == "check" ? ToggleState.On : ToggleState.Off;
        return () => ToggleTo(toggle, expected, mutation);
    }

    private static void ToggleTo(TogglePattern toggle, ToggleState expected, MutationGuard mutation)
    {
        // Never repeat an input whose state transition has not been observed.
        for (var attempt = 0; attempt < 2 && toggle.Current.ToggleState != expected; attempt++)
        {
            var before = toggle.Current.ToggleState;
            mutation.Dispatch(toggle.Toggle);
            var deadline = Environment.TickCount64 + 1000;
            while (toggle.Current.ToggleState == before && Environment.TickCount64 < deadline) Thread.Sleep(10);
            if (toggle.Current.ToggleState == before) throw new DriverException("ACTION_MAY_HAVE_COMMITTED");
        }
        if (toggle.Current.ToggleState != expected) throw new DriverException("ACTION_MAY_HAVE_COMMITTED");
    }
}

public sealed class SelectionControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind == "selectOption";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        _ = Pattern<SelectionPattern>(element, SelectionPattern.Pattern);
        _ = Candidate(element, action);
        return () =>
        {
            var selected = Candidate(element, action);
            if (!selected.Current.IsSelected) mutation.Dispatch(selected.Select);
            var deadline = Environment.TickCount64 + 1000;
            while (!selected.Current.IsSelected && Environment.TickCount64 < deadline) Thread.Sleep(10);
            if (!selected.Current.IsSelected) throw new DriverException("ACTION_MAY_HAVE_COMMITTED");
        };
    }

    private static SelectionItemPattern Candidate(AutomationElement element, JsonElement action)
    {
        // Enumerate only realized items. Opening a popup during readonly readiness
        // would commit an action before the runner has authorized dispatch.
        var option = action.GetProperty("value");
        var matches = new List<AutomationElement>();
        var items = new List<AutomationElement>();
        var remaining = 10000;
        void Visit(AutomationElement parent, int depth)
        {
            if (depth > 32 || --remaining < 0) throw new DriverException("UNSUPPORTED_CAPABILITY");
            for (var child = TreeWalker.ControlViewWalker.GetFirstChild(parent); child != null; child = TreeWalker.ControlViewWalker.GetNextSibling(child))
            {
                if (--remaining < 0) throw new DriverException("UNSUPPORTED_CAPABILITY");
                if (child.Current.ProcessId != element.Current.ProcessId) continue;
                if (child.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var item) &&
                    ((SelectionItemPattern)item).Current.SelectionContainer is { } container && Automation.Compare(container, element)) items.Add(child);
                Visit(child, depth + 1);
            }
        }
        Visit(element, 0);
        foreach (var item in items)
        {
            var match = option.ValueKind == JsonValueKind.String ? item.Current.Name == option.GetString()
                : option.TryGetProperty("index", out var index) ? items.IndexOf(item) == index.GetInt32()
                : option.TryGetProperty("label", out var label) ? item.Current.Name == label.GetString()
                : item.Current.AutomationId == option.GetProperty("value").GetString();
            if (match) matches.Add(item);
        }
        if (matches.Count == 0) throw new DriverException("NOT_ACTIONABLE");
        if (matches.Count > 1) throw new DriverException("NOT_ACTIONABLE");
        if (!matches[0].Current.IsEnabled) throw new DriverException("NOT_ACTIONABLE");
        return Pattern<SelectionItemPattern>(matches[0], SelectionItemPattern.Pattern);
    }
}

/// <summary>Scroll an already exposed owned control without fabricating pointer input.</summary>
public sealed class ScrollControlAdapter : ControlAdapter
{
    public override bool Supports(string kind) => kind == "scrollIntoView";
    public override Action Prepare(AutomationElement element, string kind, JsonElement action, MutationGuard mutation)
    {
        var scroll = Pattern<ScrollItemPattern>(element, ScrollItemPattern.Pattern);
        return () => mutation.Dispatch(scroll.ScrollIntoView);
    }
}
