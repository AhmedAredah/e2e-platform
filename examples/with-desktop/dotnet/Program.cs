using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;

namespace E2E.Platform.Examples;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--child")) { Thread.Sleep(Timeout.Infinite); return; }
        var broken = args.Contains("--planted-bug");
        var processPath = Environment.ProcessPath ?? throw new InvalidOperationException("Missing process path");
        var childStart = new ProcessStartInfo(processPath) { UseShellExecute = false, CreateNoWindow = true };
        if (Path.GetFileNameWithoutExtension(processPath).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            childStart.ArgumentList.Add(typeof(Program).Assembly.Location);
        childStart.ArgumentList.Add("--child");
        using var child = Process.Start(childStart) ?? throw new InvalidOperationException("Could not launch owned child fixture");
        var application = new Application();
        var panel = new StackPanel { Margin = new Thickness(20) };
        var input = Named(new ScrollableTextBox { Width = 300 }, "Input", "input");
        var secret = Named(new PasswordBox { Password = "fixture-secret-must-not-appear", Width = 300 }, "Password", "password");
        var result = new TextBlock { Text = "idle" };
        AutomationProperties.SetAutomationId(result, "result");
        var check = Named(new CheckBox { Content = "Enabled" }, "Enabled", "enabled");
        var choice = Named(new ComboBox { ItemsSource = new[] { "Alpha", "Beta", "Gamma" }, SelectedIndex = 0, Width = 200 }, "Choice", "choice");
        var openChoice = Named(new Button { Content = "Toggle choices" }, "Toggle choices", "toggle-choice");
        openChoice.Click += (_, _) => choice.IsDropDownOpen = !choice.IsDropDownOpen;
        var delayed = Named(new ListBox { Height = 60, Width = 200 }, "Delayed choices", "delayed-choice");
        VirtualizingStackPanel.SetIsVirtualizing(delayed, false);
        delayed.Items.Add(new ListBoxItem { Content = "Alpha", IsSelected = true });
        delayed.Items.Add(new ListBoxItem { Content = "Disabled option", IsEnabled = false });
        delayed.Items.Add(new ListBoxItem { Content = "Duplicate" });
        delayed.Items.Add(new ListBoxItem { Content = "Duplicate" });
        var selectionResult = Named(new TextBlock { Text = "Alpha" }, "Selection result", "selection-result");
        delayed.SelectionChanged += (_, _) => selectionResult.Text = (delayed.SelectedItem as ListBoxItem)?.Content?.ToString() ?? "none";
        var loadChoice = Named(new Button { Content = "Load option" }, "Load option", "load-choice");
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(350) };
        timer.Tick += (_, _) => { timer.Stop(); delayed.Items.Add(new ListBoxItem { Content = "Later" }); };
        loadChoice.Click += (_, _) => timer.Start();
        var submit = Named(new Button { Content = "Submit" }, "Submit", "submit");
        submit.Click += (_, _) => result.Text = broken ? "WRONG" : input.Text;
        var transient = Named(new Button { Content = "Transient" }, "Transient", "transient");
        var remove = Named(new Button { Content = "Remove transient" }, "Remove transient", "remove");
        remove.Click += (_, _) => panel.Children.Remove(transient);
        var readOnly = Named(new TextBox { Text = "fixed", IsReadOnly = true }, "Read only", "readonly");
        var disabled = Named(new Button { Content = "Disabled", IsEnabled = false }, "Disabled", "disabled");
        var environment = new TextBlock { Text = Environment.GetEnvironmentVariable("E2E_NATIVE_TOKEN") is null && Environment.GetEnvironmentVariable("E2E_NATIVE_PORT") is null ? "clean" : "TOKEN LEAK" };
        AutomationProperties.SetAutomationId(environment, "environment");
        var processId = new TextBlock { Text = Environment.ProcessId.ToString() };
        AutomationProperties.SetAutomationId(processId, "process-id");
        var childProcessId = new TextBlock { Text = child.Id.ToString() };
        AutomationProperties.SetAutomationId(childProcessId, "child-process-id");
        foreach (var control in new FrameworkElement[] { input, secret, result, check, openChoice, choice, delayed, loadChoice, selectionResult, submit, transient, remove, readOnly, disabled, environment, processId, childProcessId }) panel.Children.Add(control);
        panel.Children.Add(new Border { Height = 900 });
        panel.Children.Add(Named(new Button { Content = "Clipped ordinary button" }, "Clipped ordinary button", "clipped"));
        var late = Named(new ScrollableButton { Content = "Late control" }, "Late control", "late");
        late.Click += (_, _) => result.Text = "scrolled";
        panel.Children.Add(late);
        var scroll = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        try { application.Run(new Window { Title = "E2E Platform Accessible Demo", Content = scroll, Width = 420, Height = 540 }); }
        finally { if (!child.HasExited) { child.Kill(entireProcessTree: true); child.WaitForExit(5000); } }
    }

    private static T Named<T>(T element, string name, string id) where T : FrameworkElement
    {
        AutomationProperties.SetName(element, name);
        AutomationProperties.SetAutomationId(element, id);
        return element;
    }
}

/// <summary>Application integration for semantic scrolling, which ordinary WPF buttons do not expose.</summary>
internal sealed class ScrollableButton : Button
{
    protected override AutomationPeer OnCreateAutomationPeer() => new Peer(this);
    private sealed class Peer(ScrollableButton owner) : ButtonAutomationPeer(owner), IScrollItemProvider
    {
        public override object GetPattern(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.ScrollItem ? this : base.GetPattern(patternInterface);
        public void ScrollIntoView() => owner.BringIntoView();
    }
}

internal sealed class ScrollableTextBox : TextBox
{
    protected override AutomationPeer OnCreateAutomationPeer() => new Peer(this);
    private sealed class Peer(ScrollableTextBox owner) : TextBoxAutomationPeer(owner), IScrollItemProvider
    {
        public override object GetPattern(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.ScrollItem ? this : base.GetPattern(patternInterface);
        public void ScrollIntoView() => owner.BringIntoView();
    }
}
