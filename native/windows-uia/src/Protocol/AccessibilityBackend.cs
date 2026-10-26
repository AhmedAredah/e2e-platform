using System.Text.Json;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>Desktop providers implement semantic observation and explicitly bounded actions.</summary>
public abstract class AccessibilityBackend : IDisposable
{
    public abstract string Name { get; }
    public virtual string Version => "0.1.0";
    public abstract IReadOnlyList<string> Actions { get; }
    public abstract object Snapshot();
    public abstract void Perform(string id, JsonElement action);
    public abstract void Dispose();
}

/// <summary>Only stable, non-sensitive engine taxonomy codes cross the protocol boundary.</summary>
public sealed class DriverException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
