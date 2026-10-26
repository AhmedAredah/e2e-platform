using System.Text;

namespace E2E.Platform.Desktop.Protocol;

/// <summary>Quote one argument using the Windows C-runtime command-line convention.</summary>
public static class WindowsCommandLine
{
    public static string Quote(string argument)
    {
        if (argument.Contains('\0')) throw new ArgumentException("Arguments cannot contain NUL");
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
}
