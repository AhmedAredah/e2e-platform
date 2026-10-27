using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using E2E.Platform.Desktop.Protocol;

var passed = 0;
void Assert(bool condition, string label) { if (!condition) throw new Exception(label); passed++; }
const string token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
JsonElement Send(BridgeSession session, string json) { using var request = JsonDocument.Parse(json); return JsonSerializer.SerializeToElement(session.Dispatch(request.RootElement)); }
BridgeSession Authorized(FakeBackend backend)
{
    var session = new BridgeSession(backend, token);
    var reply = Send(session, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1,\"token\":\"" + token + "\"}}");
    Assert(reply.GetProperty("result").GetProperty("screenshots").GetBoolean() == false, "screenshots false");
    Assert(reply.GetProperty("result").GetProperty("actionability").GetBoolean() == backend.SupportsActionability,
        "readonly actionability is advertised only by an implementing provider");
    return session;
}
string Code(JsonElement reply) => reply.GetProperty("error").GetProperty("data").GetProperty("code").GetString()!;
var backend = new FakeBackend();
var denied = new BridgeSession(backend, token);
Assert(Code(Send(denied, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"snapshot\",\"params\":{}}")) == "ENGINE_FAILURE", "authentication first");
Assert(denied.CloseRequested && backend.Snapshots == 0, "unauthorized snapshot blocked");
var wrong = new BridgeSession(backend, token);
Assert(Code(Send(wrong, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1,\"token\":\"wrong\"}}")) == "ENGINE_FAILURE", "wrong token");
Assert(wrong.CloseRequested, "unauthorized session closes");
var session = Authorized(backend);
Assert(Send(session, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"snapshot\",\"params\":{\"pixels\":true}}").TryGetProperty("result", out _), "snapshot supported without pixels");
Assert(backend.Snapshots == 1, "snapshot dispatched once");
var fill = "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"perform\",\"params\":{\"ref\":{\"id\":\"n1\",\"revision\":\"r1\"},\"action\":{\"kind\":\"fill\",\"value\":\"private\",\"sensitive\":true}}}";
Assert(Send(session, fill).GetProperty("result").ValueKind == JsonValueKind.Null, "fill acknowledgement null");
Assert(backend.Mutations == 1 && backend.LastId == "n1", "fill dispatched once");
Assert(Code(Send(session, fill)) == "ENGINE_FAILURE" && backend.Mutations == 1 && session.CloseRequested, "replayed request rejected");
var unknown = Authorized(backend);
Assert(Code(Send(unknown, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"keyboard.press\",\"params\":{\"key\":\"A\"}}")) == "UNSUPPORTED_CAPABILITY", "keyboard refused");
var unavailable = Authorized(backend);
Assert(Code(Send(unavailable, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"perform\",\"params\":{\"ref\":{\"id\":\"n1\",\"revision\":\"r1\"},\"action\":{\"kind\":\"check\"}}}")) == "UNSUPPORTED_CAPABILITY", "unadvertised action refused");
var extra = Authorized(backend);
Assert(Code(Send(extra, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"snapshot\",\"params\":{\"secret\":\"hidden\"}}")) == "ENGINE_FAILURE", "unknown fields refused");
var dup = Authorized(backend);
Assert(Code(Send(dup, "{\"jsonrpc\":\"2.0\",\"id\":2,\"id\":3,\"method\":\"snapshot\",\"params\":{}}")) == "ENGINE_FAILURE", "duplicate fields refused");
var shutdown = Authorized(backend);
Assert(Send(shutdown, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}").GetProperty("result").ValueKind == JsonValueKind.Null && shutdown.CloseRequested, "shutdown acknowledged");
var actionCases = new[] {
    "{\"kind\":\"tap\",\"modifiers\":[\"Shift\"]}",
    "{\"kind\":\"fill\",\"value\":1}",
    "{\"kind\":\"fill\",\"value\":\"a\",\"sensitive\":1}",
    "{\"kind\":\"selectOption\",\"value\":{\"index\":-1}}",
    "{\"kind\":\"selectOption\",\"value\":{\"label\":\"a\",\"index\":0}}"
};
foreach (var action in actionCases)
{
    using var document = JsonDocument.Parse(action);
    var rejected = false;
    try { RequestValidator.Action(document.RootElement); } catch (DriverException) { rejected = true; }
    Assert(rejected, "bad action rejected " + action);
}
Assert(WindowsCommandLine.Quote("") == "\"\"", "empty argument quoted");
Assert(WindowsCommandLine.Quote("hello world") == "\"hello world\"", "space argument quoted");
Assert(WindowsCommandLine.Quote("a\"b") == "\"a\\\"b\"", "quote escaped");
Assert(WindowsCommandLine.Quote("C:\\tail\\") == "\"C:\\tail\\\\\"", "trailing slash escaped");
using (var server = new BridgeServer(backend, token))
{
    var port = server.Start();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    var work = server.RunAsync(timeout.Token);
    using var client = new TcpClient();
    await client.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
    using var stream = client.GetStream();
    var bytes = Encoding.UTF8.GetBytes("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1,\"token\":\"" + token + "\"}}\n");
    await stream.WriteAsync(bytes.AsMemory(0, 13), timeout.Token);
    await stream.WriteAsync(bytes.AsMemory(13), timeout.Token);
    using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
    var line = await reader.ReadLineAsync(timeout.Token);
    Assert(line != null && !line.Contains(token) && JsonDocument.Parse(line).RootElement.TryGetProperty("result", out _), "fragmented TCP auth response no token");
    client.Close();
    await work.WaitAsync(timeout.Token);
    Assert(true, "EOF ends session");
}
var sensitivity = new ControlSensitivity();
Assert(!sensitivity.Observe("control-1", false), "ordinary control retains public semantics");
Assert(sensitivity.Observe("control-1", true), "provider password classification is recorded");
Assert(sensitivity.Observe("control-1", false), "password reveal cannot clear retained sensitivity");
Assert(!sensitivity.Observe("control-2", false), "replacement control identity does not inherit sensitivity");
sensitivity.Forget("control-1");
Assert(!sensitivity.Observe("control-1", false), "retired identity releases sensitivity");
var budget = new SnapshotBudget(1024);
Assert(budget.TryNode(), "node budget available");
Assert(budget.Text(new string('x', 60000)).StartsWith("[omitted:"), "oversized aggregate text omitted before serialization");
Assert(budget.Truncated && !budget.TryNode(), "aggregate truncation cannot silently imply completeness");
var fieldBudget = new SnapshotBudget();
Assert(fieldBudget.Text(new string('x', 11), 10).StartsWith("[omitted:") && fieldBudget.Truncated,
    "an individually omitted field cannot silently imply completeness");
Assert(ControlSemantics.Role(50008) == "listbox" && ControlSemantics.Role(50007) == "option",
    "selection controls use the shared native listbox/option contract");
Assert(ControlSemantics.Role(50028) == "grid" && ControlSemantics.Role(50036) == "grid" &&
    ControlSemantics.Role(50029, true) == "gridcell" && ControlSemantics.Role(50029) == "row",
    "grid pattern distinguishes a cell from a row");
Assert(ControlSemantics.Role(50034) == "group" && ControlSemantics.Role(50035) == "group",
    "header containers and unknown header orientation do not invent cell semantics");
var previousCulture = System.Globalization.CultureInfo.CurrentCulture;
var clipped = new ViewportVisibility(new(10, 800, 100, 20));
clipped.Clip(new(0, 0, 200, 100), false);
clipped.Clip(new(0, 0, 400, 900), true);
Assert(clipped.Result == ControlVisibility.Hidden, "a window cannot restore a control clipped by a nested viewport");
var partial = new ViewportVisibility(new(10, 90, 100, 20));
partial.Clip(new(0, 0, 200, 100), false);
Assert(partial.Result == ControlVisibility.Unknown, "scroll geometry alone does not establish an owned window");
partial.Clip(new(0, 0, 400, 500), true);
Assert(partial.Result == ControlVisibility.Visible, "positive viewport intersection is semantically visible");
var missingBounds = new ViewportVisibility(new(double.NaN, 0, 10, 10));
missingBounds.Clip(new(0, 0, 400, 500), true);
Assert(missingBounds.Result == ControlVisibility.Unknown, "nonfinite provider bounds never prove visibility");
var emptyBounds = new ViewportVisibility(new(0, 0, 10, 10));
emptyBounds.Clip(new(0, 0, 0, 0), true);
Assert(emptyBounds.Result == ControlVisibility.Unknown, "missing window geometry remains uncertain");
try
{
    System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("fr-FR");
    Assert(ControlSemantics.NumericValue(12.5) == "12.5", "numeric observations are independent of host locale");
    var invalidNumber = false;
    try { ControlSemantics.NumericValue(double.NaN); } catch (DriverException error) { invalidNumber = error.Code == "ENGINE_FAILURE"; }
    Assert(invalidNumber, "nonfinite provider values cannot become successful value assertions");
}
finally { System.Globalization.CultureInfo.CurrentCulture = previousCulture; }
var preDispatch = new MutationGuard();
var observation = new ObservedControls();
observation.Complete(["original"]);
Assert(observation.Contains("original"), "successful observation authorizes the returned control");
observation.Invalidate();
Assert(!observation.Contains("original"), "a failed or incomplete observation cannot retain old action authorization");
observation.Complete(["replacement"]);
Assert(!observation.Contains("original") && observation.Contains("replacement"), "replacement observation authorizes only its own controls");
var preDispatchCode = "";
try { preDispatch.Run(() => throw new DriverException("NOT_ACTIONABLE")); }
catch (DriverException error) { preDispatchCode = error.Code; }
Assert(preDispatchCode == "NOT_ACTIONABLE", "confirmed pre-dispatch rejection remains eligible for waiting");
var mutations = 0;
foreach (var throwsDuringDispatch in new[] { true, false })
{
    var mutation = new MutationGuard();
    var uncertainCode = "";
    try
    {
        mutation.Run(() =>
        {
            mutation.Dispatch(() =>
            {
                mutations++;
                if (throwsDuringDispatch) throw new DriverException("NOT_ACTIONABLE");
            });
            throw new DriverException("NODE_STALE");
        });
    }
    catch (DriverException error) { uncertainCode = error.Code; }
    Assert(uncertainCode == "ACTION_MAY_HAVE_COMMITTED", "failure during or after mutation must never authorize retry");
}
Assert(mutations == 2, "uncertain platform calls are dispatched once each");
var scrollBackend = new FakeBackend();
var scrolling = Authorized(scrollBackend);
Assert(Send(scrolling, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"perform\",\"params\":{\"ref\":{\"id\":\"offscreen\",\"revision\":\"r1\"},\"action\":{\"kind\":\"scrollIntoView\"}}}").GetProperty("result").ValueKind == JsonValueKind.Null,
    "scroll action has an explicit protocol route");
Assert(scrollBackend.Mutations == 1 && scrollBackend.LastId == "offscreen", "scroll route preserves the selected owned reference");
var badScroll = "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"perform\",\"params\":{\"ref\":{\"id\":\"offscreen\",\"revision\":\"r1\"},\"action\":{\"kind\":\"scrollIntoView\",\"x\":100}}}";
Assert(Code(Send(scrolling, badScroll)) == "ENGINE_FAILURE" && scrollBackend.Mutations == 1,
    "semantic scroll cannot silently accept coordinate input");
var legacyPreflight = Authorized(new FakeBackend());
const string readinessRequest = "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"actionability\",\"params\":{\"ref\":{\"id\":\"ready-control\",\"revision\":\"r1\"},\"action\":{\"kind\":\"tap\"}}}";
Assert(Code(Send(legacyPreflight, readinessRequest)) == "UNSUPPORTED_CAPABILITY", "legacy provider does not silently claim readonly preflight");
var readOnlyBackend = new PreflightBackend();
var readOnly = Authorized(readOnlyBackend);
Assert(Send(readOnly, readinessRequest).GetProperty("result").ValueKind == JsonValueKind.Null && readOnlyBackend.Probes == 1 && readOnlyBackend.Mutations == 0,
    "preflight is routed separately and cannot dispatch a mutation");
var retryableBackend = new PreflightBackend { Ready = false };
var retryablePreflight = Authorized(retryableBackend);
Assert(Code(Send(retryablePreflight, readinessRequest)) == "NOT_ACTIONABLE" && !retryablePreflight.CloseRequested && retryableBackend.Mutations == 0,
    "unready preflight keeps the session available without mutating");
retryableBackend.Ready = true;
Assert(Send(retryablePreflight, readinessRequest.Replace("\"id\":2", "\"id\":3")).GetProperty("result").ValueKind == JsonValueKind.Null && retryableBackend.Probes == 2 && retryableBackend.Mutations == 0,
    "a later readonly probe can observe readiness without repeating input");
var malformedProbe = Authorized(readOnlyBackend);
Assert(Code(Send(malformedProbe, readinessRequest.Replace("\"kind\":\"tap\"", "\"kind\":\"tap\",\"value\":\"extra\""))) == "ENGINE_FAILURE" && readOnlyBackend.Probes == 1,
    "preflight shares closed action validation before provider access");
Console.WriteLine(JsonSerializer.Serialize(new { suite = "windows-uia-portable-protocol", passed, failed = 0, platform = Environment.OSVersion.Platform.ToString(), windowsGuiVerified = false }));
return 0;

class FakeBackend : AccessibilityBackend
{
    public int Snapshots, Mutations;
    public string? LastId;
    public override string Name => "test-provider";
    public override IReadOnlyList<string> Actions => ["tap", "fill", "scrollIntoView"];
    public override object Snapshot() { Snapshots++; return new { root = new { @ref = new { id = "root", revision = "" } }, viewport = new { width = 1, height = 1 } }; }
    public override void Perform(string id, JsonElement action) { Mutations++; LastId = id; }
    public override void Dispose() { }
}

sealed class PreflightBackend : FakeBackend
{
    public int Probes;
    public bool Ready = true;
    public override bool SupportsActionability => true;
    public override void Actionability(string id, JsonElement action)
    {
        Probes++;
        if (!Ready) throw new DriverException("NOT_ACTIONABLE");
    }
}
