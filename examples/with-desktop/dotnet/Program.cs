using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

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
        var input = Named(new TextBox { Width = 300 }, "Input", "input");
        var secret = Named(new PasswordBox { Password = "fixture-secret-must-not-appear", Width = 300 }, "Password", "password");
        var result = new TextBlock { Text = "idle" };
        AutomationProperties.SetAutomationId(result, "result");
        var check = Named(new CheckBox { Content = "Enabled" }, "Enabled", "enabled");
        var choice = Named(new ComboBox { ItemsSource = new[] { "Alpha", "Beta", "Gamma" }, SelectedIndex = 0, Width = 200 }, "Choice", "choice");
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
        foreach (var control in new FrameworkElement[] { input, secret, result, check, choice, submit, transient, remove, readOnly, disabled, environment, processId, childProcessId }) panel.Children.Add(control);
        panel.Children.Add(new Border { Height = 900 });
        var late = Named(new Button { Content = "Late control" }, "Late control", "late");
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
