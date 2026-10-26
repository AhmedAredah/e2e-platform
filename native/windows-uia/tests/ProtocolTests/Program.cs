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
var budget = new SnapshotBudget(1024);
Assert(budget.TryNode(), "node budget available");
Assert(budget.Text(new string('x', 60000)).StartsWith("[omitted:"), "oversized aggregate text omitted before serialization");
Assert(budget.Truncated && !budget.TryNode(), "aggregate truncation cannot silently imply completeness");
Console.WriteLine(JsonSerializer.Serialize(new { suite = "windows-uia-portable-protocol", passed, failed = 0, platform = Environment.OSVersion.Platform.ToString(), windowsGuiVerified = false }));
return 0;

sealed class FakeBackend : AccessibilityBackend
{
    public int Snapshots, Mutations;
    public string? LastId;
    public override string Name => "test-provider";
    public override IReadOnlyList<string> Actions => ["tap", "fill"];
    public override object Snapshot() { Snapshots++; return new { root = new { @ref = new { id = "root", revision = "" } }, viewport = new { width = 1, height = 1 } }; }
    public override void Perform(string id, JsonElement action) { Mutations++; LastId = id; }
    public override void Dispose() { }
}
