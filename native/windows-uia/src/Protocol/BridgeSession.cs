using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>One authenticated native-bridge-v1 session with strictly increasing request IDs.</summary>
public sealed class BridgeSession(AccessibilityBackend backend, string token)
{
    private bool authenticated;
    private long lastId;
    public bool Authenticated => authenticated;
    public bool CloseRequested { get; private set; }

    public object Dispatch(JsonElement request)
    {
        long id = 0;
        try
        {
            RequestValidator.Object(request, "jsonrpc", "id", "method", "params");
            if (RequestValidator.String(request, "jsonrpc", 3) != "2.0" ||
                !request.TryGetProperty("id", out var rawId) || !rawId.TryGetInt64(out id) ||
                id <= lastId || id > 9007199254740991 || !request.TryGetProperty("params", out var parameters))
                throw new DriverException("ENGINE_FAILURE");
            lastId = id;
            var method = RequestValidator.String(request, "method", 128);
            object? result;
            if (!authenticated)
            {
                if (method != "initialize") throw new DriverException("ENGINE_FAILURE");
                RequestValidator.Object(parameters, "protocolVersion", "token");
                if (!parameters.TryGetProperty("protocolVersion", out var version) || !version.TryGetInt32(out var versionNumber) || versionNumber != 1)
                    throw new DriverException("ENGINE_FAILURE");
                var candidate = RequestValidator.String(parameters, "token", 64);
                if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(candidate)))
                    throw new DriverException("ENGINE_FAILURE");
                authenticated = true;
                result = new { protocolVersion = 1, name = backend.Name, version = backend.Version, actions = backend.Actions, keyboard = false, screenshots = false };
            }
            else
            {
                switch (method)
                {
                    case "snapshot":
                        RequestValidator.Object(parameters, "pixels");
                        if (parameters.TryGetProperty("pixels", out var pixels) && pixels.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                            throw new DriverException("ENGINE_FAILURE");
                        result = backend.Snapshot(); break;
                    case "perform":
                        RequestValidator.Object(parameters, "ref", "action");
                        if (!parameters.TryGetProperty("ref", out var reference) || !parameters.TryGetProperty("action", out var action))
                            throw new DriverException("ENGINE_FAILURE");
                        RequestValidator.Object(reference, "id", "revision");
                        var nodeId = RequestValidator.String(reference, "id", 512);
                        _ = RequestValidator.String(reference, "revision");
                        if (nodeId.Length == 0) throw new DriverException("ENGINE_FAILURE");
                        RequestValidator.Action(action);
                        if (!backend.Actions.Contains(RequestValidator.String(action, "kind"), StringComparer.Ordinal)) throw new DriverException("UNSUPPORTED_CAPABILITY");
                        backend.Perform(nodeId, action); result = null; break;
                    case "shutdown":
                        RequestValidator.Object(parameters); CloseRequested = true; result = null; break;
                    case "initialize": throw new DriverException("INVALID_STATE");
                    default: throw new DriverException("UNSUPPORTED_CAPABILITY");
                }
            }
            return new { jsonrpc = "2.0", id, result };
        }
        catch (DriverException error)
        {
            if (!authenticated || error.Code is "ENGINE_FAILURE" or "ACTION_MAY_HAVE_COMMITTED") CloseRequested = true;
            return Error(id, error.Code);
        }
        catch
        {
            CloseRequested = true;
            return Error(id, "ENGINE_FAILURE");
        }
    }

    public static object Error(long id, string code) => new { jsonrpc = "2.0", id, error = new { code = -32000, message = code, data = new { code } } };
}
