using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using E2E.Platform.Desktop.Protocol;

namespace E2E.Platform.WindowsUia;

/// <summary>Suspended launch closes the child-escape race before assigning a kill-on-close job.</summary>
public sealed class OwnedWindowsProcess : IDisposable
{
    private IntPtr job;
    private IntPtr process;
    public int Id { get; private set; }
    public bool HasExited => process == IntPtr.Zero || WaitForSingleObject(process, 0) == 0;

    public OwnedWindowsProcess(string executable, IReadOnlyList<string> arguments)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows UIA requires Windows");
        if (!Path.IsPathFullyQualified(executable) || !File.Exists(executable)) throw new ArgumentException("Application executable must be an existing absolute path");
        var command = new StringBuilder(string.Join(' ', new[] { executable }.Concat(arguments).Select(WindowsCommandLine.Quote)));
        var environment = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Where(pair => !string.Equals((string)pair.Key, "E2E_NATIVE_TOKEN", StringComparison.OrdinalIgnoreCase) && !string.Equals((string)pair.Key, "E2E_NATIVE_PORT", StringComparison.OrdinalIgnoreCase))
            .OrderBy(pair => (string)pair.Key, StringComparer.OrdinalIgnoreCase)
            .Select(pair => pair.Key + "=" + pair.Value);
        var environmentText = string.Join('\0', environment) + "\0\0";
        var startup = new StartupInformation { Size = (uint)Marshal.SizeOf<StartupInformation>() };
        var block = IntPtr.Zero;
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            var limits = new JobExtendedLimitInformation { BasicLimitInformation = new JobBasicLimitInformation { LimitFlags = 0x2000 } };
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JobExtendedLimitInformation>())) throw new Win32Exception();
            block = Marshal.StringToHGlobalUni(environmentText);
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000004 | 0x00000400, block, Environment.CurrentDirectory, ref startup, out var info))
                throw new Win32Exception();
            process = info.Process;
            Id = unchecked((int)info.ProcessId);
            try
            {
                if (!AssignProcessToJobObject(job, process))
                {
                    var error = new Win32Exception(); TerminateProcess(process, 1); throw error;
                }
                if (ResumeThread(info.Thread) == uint.MaxValue) throw new Win32Exception();
            }
            finally { CloseHandle(info.Thread); }
        }
        catch { Dispose(); throw; }
        finally { if (block != IntPtr.Zero) Marshal.FreeHGlobal(block); }
    }

    public void Dispose()
    {
        var closed = true;
        var stopped = true;
        if (job != IntPtr.Zero)
        {
            stopped = TerminateJobObject(job, 0);
            var deadline = Environment.TickCount64 + 5000;
            while (stopped)
            {
                if (!QueryInformationJobObject(job, 1, out var accounting, (uint)Marshal.SizeOf<JobBasicAccountingInformation>(), IntPtr.Zero)) { stopped = false; break; }
                if (accounting.ActiveProcesses == 0) break;
                if (Environment.TickCount64 >= deadline) { stopped = false; break; }
                Thread.Sleep(10);
            }
            closed = CloseHandle(job);
            job = IntPtr.Zero;
        }
        if (process != IntPtr.Zero)
        {
            stopped = WaitForSingleObject(process, 5000) == 0 && stopped;
            closed = CloseHandle(process) && closed;
            process = IntPtr.Zero;
        }
        if (!closed || !stopped) throw new DriverException("ENGINE_FAILURE");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobBasicAccountingInformation
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobBasicLimitInformation
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobExtendedLimitInformation
    {
        public JobBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInformation
    {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public ushort ShowWindow, Reserved2Size;
        public IntPtr Reserved2, StandardInput, StandardOutput, StandardError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref JobExtendedLimitInformation information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInformation startup, out ProcessInformation information);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out JobBasicAccountingInformation information, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
