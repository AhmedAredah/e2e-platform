using System.Text.Json;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>Closed payload validation prevents accidental capability broadening.</summary>
public static class RequestValidator
{
    public static void Object(JsonElement value, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new DriverException("ENGINE_FAILURE");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                throw new DriverException("ENGINE_FAILURE");
    }

    public static string String(JsonElement value, string key, int maximum = 65536)
    {
        if (!value.TryGetProperty(key, out var property) || property.ValueKind != JsonValueKind.String)
            throw new DriverException("ENGINE_FAILURE");
        var result = property.GetString()!;
        if (result.Length > maximum) throw new DriverException("ENGINE_FAILURE");
        return result;
    }

    public static void Action(JsonElement action)
    {
        var kind = String(action, "kind", 64);
        switch (kind)
        {
            case "tap": case "clear": case "focus": case "check": case "uncheck":
                Object(action, "kind"); break;
            case "fill":
                Object(action, "kind", "value", "sensitive");
                _ = String(action, "value");
                if (action.TryGetProperty("sensitive", out var sensitive) && sensitive.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw new DriverException("ENGINE_FAILURE");
                break;
            case "selectOption":
                Object(action, "kind", "value");
                if (!action.TryGetProperty("value", out var option)) throw new DriverException("ENGINE_FAILURE");
                if (option.ValueKind == JsonValueKind.String)
                {
                    if (option.GetString()!.Length > 65536) throw new DriverException("ENGINE_FAILURE");
                }
                else
                {
                    Object(option, "label", "value", "index");
                    if (option.EnumerateObject().Count() != 1) throw new DriverException("ENGINE_FAILURE");
                    if (option.TryGetProperty("index", out var index))
                    {
                        if (!index.TryGetInt32(out var number) || number < 0) throw new DriverException("ENGINE_FAILURE");
                    }
                    else _ = String(option, option.TryGetProperty("label", out _) ? "label" : "value");
                }
                break;
            default: throw new DriverException("UNSUPPORTED_CAPABILITY");
        }
    }
}
