using System.Text.Json;

namespace E2E.Platform.WindowsProcess.Protocol;

public sealed class ProtocolException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public sealed record LaunchSpec(string Executable, string[] Arguments, string Cwd,
    IReadOnlyDictionary<string, string> Environment, int ParentPid, int DrainTimeoutMs);

public sealed record Request(long Id, string Kind, LaunchSpec? Launch = null, byte[]? Data = null);

/// <summary>Closed, bounded controller commands. No input values are included in errors.</summary>
public sealed class RequestParser
{
    public const int MaximumFrameBytes = 128 * 1024;
    public const int MaximumInputBytes = 64 * 1024;
    private long lastId;

    public Request Parse(ReadOnlyMemory<byte> bytes)
    {
        if (bytes.Length > MaximumFrameBytes) throw Invalid();
        try
        {
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            var kind = Text(root, "kind", 32);
            if (!root.TryGetProperty("id", out var rawId) || !rawId.TryGetInt64(out var id) ||
                id <= lastId || id > 9_007_199_254_740_991) throw Invalid();
            if (lastId == 0 && (kind != "launch" || id != 1)) throw Invalid();
            Request result;
            switch (kind)
            {
                case "launch":
                    if (lastId != 0) throw Invalid();
                    Fields(root, "kind", "version", "id", "executable", "args", "cwd", "env", "parentPid", "drainTimeoutMs");
                    if (!root.TryGetProperty("version", out var version) || !version.TryGetInt32(out var protocol) || protocol != 1) throw Invalid();
                    var executable = Text(root, "executable", 32767);
                    var cwd = Text(root, "cwd", 32767);
                    if (executable.Length == 0 || cwd.Length == 0) throw Invalid();
                    if (!root.TryGetProperty("args", out var args) || args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 4096) throw Invalid();
                    var arguments = args.EnumerateArray().Select(value => String(value, 32767)).ToArray();
                    if (!root.TryGetProperty("env", out var env) || env.ValueKind != JsonValueKind.Object) throw Invalid();
                    var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    var environmentSize = 1;
                    foreach (var pair in env.EnumerateObject())
                    {
                        var value = String(pair.Value, 65535);
                        if (pair.Name.Length == 0 || pair.Name.Contains('\0') || pair.Name.Contains('=') || !environment.TryAdd(pair.Name, value)) throw Invalid();
                        environmentSize = checked(environmentSize + pair.Name.Length + value.Length + 2);
                        if (environmentSize > 65536) throw Invalid();
                    }
                    if (!root.TryGetProperty("parentPid", out var parent) || !parent.TryGetInt32(out var parentPid) || parentPid <= 0) throw Invalid();
                    var drain = 5000;
                    if (root.TryGetProperty("drainTimeoutMs", out var timeout) && (!timeout.TryGetInt32(out drain) || drain < 0 || drain > 30000)) throw Invalid();
                    result = new Request(id, kind, new LaunchSpec(executable, arguments, cwd, environment, parentPid, drain));
                    break;
                case "stdin":
                    Fields(root, "kind", "id", "data");
                    var encoded = Text(root, "data", 87384);
                    var data = Convert.FromBase64String(encoded);
                    if (data.Length > MaximumInputBytes || Convert.ToBase64String(data) != encoded) throw Invalid();
                    result = new Request(id, kind, Data: data);
                    break;
                case "eof": case "stop":
                    Fields(root, "kind", "id");
                    result = new Request(id, kind);
                    break;
                default: throw Invalid();
            }
            lastId = id;
            return result;
        }
        catch (ProtocolException) { throw; }
        catch { throw Invalid(); }
    }

    private static void Fields(JsonElement value, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pair in value.EnumerateObject())
            if (!allowed.Contains(pair.Name, StringComparer.Ordinal) || !seen.Add(pair.Name)) throw Invalid();
    }
    private static string Text(JsonElement parent, string key, int limit) =>
        parent.TryGetProperty(key, out var value) ? String(value, limit) : throw Invalid();
    private static string String(JsonElement value, int limit)
    {
        if (value.ValueKind != JsonValueKind.String) throw Invalid();
        var result = value.GetString()!;
        return result.Length <= limit && !result.Contains('\0') ? result : throw Invalid();
    }
    private static ProtocolException Invalid() => new("INVALID_REQUEST");
}
