using System.Text;
using System.Text.Json;
using E2E.Platform.WindowsProcess.Protocol;

var passed = 0;
void Check(bool value, string name) { if (!value) throw new Exception(name); passed++; }
byte[] Bytes(object value) => JsonSerializer.SerializeToUtf8Bytes(value);
Dictionary<string, object?> Launch() => new()
{
    ["kind"] = "launch", ["id"] = 1, ["version"] = 1, ["executable"] = "C:\\test app\\app.exe",
    ["args"] = new[] { "", "quoted\"", "雪" }, ["cwd"] = "C:\\test app", ["env"] = new Dictionary<string, string> { ["A"] = "value" }, ["parentPid"] = 12
};
void Reject(byte[] value, string name, RequestParser? parser = null)
{
    try { (parser ?? new RequestParser()).Parse(value); throw new Exception(name); }
    catch (ProtocolException error) { Check(error.Code == "INVALID_REQUEST" && error.Message == "INVALID_REQUEST", name); }
}
RequestParser Started()
{
    var parser = new RequestParser(); parser.Parse(Bytes(Launch())); return parser;
}
var initial = new RequestParser().Parse(Bytes(Launch()));
Check(initial.Id == 1 && initial.Launch!.DrainTimeoutMs == 5000 && initial.Launch.Arguments[2] == "雪", "launch values and default");
foreach (var field in new[] { "kind", "id", "version", "executable", "args", "cwd", "env", "parentPid" })
{
    var value = Launch(); value.Remove(field); Reject(Bytes(value), "required " + field);
}
foreach (var (field, value) in new (string, object?)[]
{
    ("kind", "stdin"), ("id", 0), ("id", 2), ("id", 1.5), ("version", 2), ("version", "1"),
    ("parentPid", 0), ("parentPid", -1), ("parentPid", 1.5), ("drainTimeoutMs", -1), ("drainTimeoutMs", 30001),
    ("drainTimeoutMs", 1.5), ("drainTimeoutMs", null), ("executable", ""), ("cwd", ""), ("args", "bad"),
    ("args", new[] { "nul\0" }), ("env", new Dictionary<string, string> { ["A=B"] = "bad" }),
    ("env", new Dictionary<string, string> { ["A"] = "secret\0" }), ("unknown", "secret")
})
{
    var request = Launch(); request[field] = value; Reject(Bytes(request), "invalid " + field);
}
var zeroDrain = Launch(); zeroDrain["drainTimeoutMs"] = 0;
Check(new RequestParser().Parse(Bytes(zeroDrain)).Launch!.DrainTimeoutMs == 0, "zero drain accepted");
var maxDrain = Launch(); maxDrain["drainTimeoutMs"] = 30000;
Check(new RequestParser().Parse(Bytes(maxDrain)).Launch!.DrainTimeoutMs == 30000, "maximum drain accepted");
var duplicate = Encoding.UTF8.GetString(Bytes(Launch())).Replace("\"id\":1", "\"id\":1,\"id\":1");
Reject(Encoding.UTF8.GetBytes(duplicate), "duplicate fields");
var duplicateEnvironment = Encoding.UTF8.GetString(Bytes(Launch())).Replace("\"A\":\"value\"", "\"A\":\"value\",\"a\":\"other\"");
Reject(Encoding.UTF8.GetBytes(duplicateEnvironment), "environment names case insensitive");
Reject(Bytes(Launch()), "cannot launch twice", Started());
Reject(Bytes(new { kind = "eof", id = 1 }), "replayed id", Started());
Reject(Bytes(new { kind = "stop", id = 9_007_199_254_740_992L }), "unsafe JS id", Started());
Reject(Bytes(new { kind = "eof", id = 2, data = "" }), "closed eof fields", Started());
Reject(Bytes(new { kind = "stop", id = 2, extra = true }), "closed stop fields", Started());
foreach (var bad in new[] { "AA", " A A==", "AA==\n", "?", "AB==" })
    Reject(Bytes(new { kind = "stdin", id = 2, data = bad }), "canonical base64 " + bad.Length, Started());
var content = Enumerable.Range(0, RequestParser.MaximumInputBytes).Select(value => (byte)value).ToArray();
Check(Started().Parse(Bytes(new { kind = "stdin", id = 2, data = Convert.ToBase64String(content) })).Data!.SequenceEqual(content), "maximum binary stdin");
Reject(Bytes(new { kind = "stdin", id = 2, data = Convert.ToBase64String(new byte[RequestParser.MaximumInputBytes + 1]) }), "oversized stdin", Started());
Reject(new byte[RequestParser.MaximumFrameBytes + 1], "oversized frame");
Reject(Encoding.UTF8.GetBytes("[]"), "nonobject");
Reject(Encoding.UTF8.GetBytes("{"), "malformed JSON");
var sequence = Started();
Reject(Bytes(new { kind = "stop", id = 2, extra = true }), "invalid command does not advance sequence", sequence);
Check(sequence.Parse(Bytes(new { kind = "eof", id = 2 })).Kind == "eof", "id after rejected frame");
Check(sequence.Parse(Bytes(new { kind = "stop", id = 4 })).Id == 4, "increasing noncontiguous id");
foreach (var (value, expected) in new[]
{
    ("", "\"\""), ("plain", "\"plain\""), ("a b", "\"a b\""), ("a\"b", "\"a\\\"b\""),
    ("end\\", "\"end\\\\\""), ("\\\"", "\"\\\\\\\"\""), ("雪&%$;", "\"雪&%$;\"")
}) Check(CommandLine.Quote(value) == expected, "Windows argument quoting");
var frames = Bytes(Launch()).Concat(new byte[] { 10 }).Concat(Bytes(new { kind = "eof", id = 2 })).Concat(new byte[] { 10 }).ToArray();
var reader = new FrameReader(new FragmentedStream(frames));
Check((await reader.ReadAsync(default))!.Kind == "launch", "fragmented launch");
Check((await reader.ReadAsync(default))!.Kind == "eof", "fragmented second frame");
Check(await reader.ReadAsync(default) is null, "clean EOF");
foreach (var bytes in new[] { Bytes(Launch()), Enumerable.Repeat((byte)' ', RequestParser.MaximumFrameBytes + 1).ToArray() })
{
    try { await new FrameReader(new MemoryStream(bytes)).ReadAsync(default); throw new Exception("frame rejection"); }
    catch (ProtocolException error) { Check(error.Code == "INVALID_REQUEST", "incomplete or oversized frame"); }
}
Console.WriteLine($"PASS {passed} protocol checks");

sealed class FragmentedStream(byte[] data) : MemoryStream(data)
{
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        base.ReadAsync(buffer[..Math.Min(buffer.Length, 3)], cancellationToken);
}
