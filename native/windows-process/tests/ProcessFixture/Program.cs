using System.Diagnostics;
using System.Reflection;
using System.Text.Json;

switch (args.FirstOrDefault())
{
    case "echo":
        await Console.OpenStandardError().WriteAsync(new byte[] { 0, 255, 10, 128 });
        await Console.OpenStandardInput().CopyToAsync(Console.OpenStandardOutput());
        return 7;
    case "arguments":
        Console.WriteLine(JsonSerializer.Serialize(new { arguments = args.Skip(1), cwd = Environment.CurrentDirectory, marker = Environment.GetEnvironmentVariable("FIXTURE_MARKER"), excluded = Environment.GetEnvironmentVariable("FIXTURE_EXCLUDED") }));
        return 0;
    case "sleep":
        Console.WriteLine("ready");
        await Task.Delay(Timeout.Infinite);
        return 0;
    case "quiet":
        await Task.Delay(Timeout.Infinite);
        return 0;
    case "tree-exit": case "tree-wait":
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("quiet");
        using (var child = Process.Start(start)!)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { childPid = child.Id, rootPid = Environment.ProcessId }));
            if (args[0] == "tree-wait") await Task.Delay(Timeout.Infinite);
        }
        return 23;
    case "output":
        var block = Enumerable.Range(0, 16384).Select(value => (byte)value).ToArray();
        for (var i = 0; i < 192; i++) await Console.OpenStandardOutput().WriteAsync(block);
        return 0;
    default: return 2;
}
