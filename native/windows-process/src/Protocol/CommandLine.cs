namespace E2E.Platform.WindowsProcess.Protocol;

/// <summary>Quote each literal argument using the Windows C runtime command-line grammar.</summary>
public static class CommandLine
{
    public static string Quote(string value)
    {
        var result = new System.Text.StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
}
