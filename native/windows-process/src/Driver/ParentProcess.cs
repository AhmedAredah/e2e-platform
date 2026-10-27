using System.Runtime.InteropServices;
using E2E.Platform.WindowsProcess.Protocol;

namespace E2E.Platform.WindowsProcess;

/// <summary>Holds a process handle so later PID reuse cannot change the lifetime being watched.</summary>
internal sealed class ParentProcess : IDisposable
{
    private IntPtr handle;
    public ParentProcess(int id)
    {
        if (!OperatingSystem.IsWindows() || id == Environment.ProcessId) throw new ProtocolException("LAUNCH_FAILED");
        handle = OpenProcess(0x00100000, false, id);
        if (handle == IntPtr.Zero) throw new ProtocolException("LAUNCH_FAILED");
        if (HasExited) { Dispose(); throw new ProtocolException("LAUNCH_FAILED"); }
    }
    public bool HasExited
    {
        get
        {
            var status = WaitForSingleObject(handle, 0);
            if (status == uint.MaxValue) throw new ProtocolException("IO_FAILED");
            return status == 0;
        }
    }
    public void Dispose() { if (handle != IntPtr.Zero) CloseHandle(handle); handle = IntPtr.Zero; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int id);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
