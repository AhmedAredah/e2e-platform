using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using E2E.Platform.WindowsProcess.Protocol;
using Microsoft.Win32.SafeHandles;

namespace E2E.Platform.WindowsProcess;

/// <summary>A process created inside a private kill-on-close job before its first instruction.</summary>
internal sealed class OwnedJobProcess : IDisposable
{
    private IntPtr job;
    private IntPtr process;
    private readonly object gate = new();
    private bool terminationRequested;
    public int Id { get; private set; }
    public FileStream Input { get; private set; } = null!;
    public FileStream Output { get; private set; } = null!;
    public FileStream Error { get; private set; } = null!;

    public OwnedJobProcess(LaunchSpec spec)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10) || !Path.IsPathFullyQualified(spec.Executable) ||
            !File.Exists(spec.Executable) || !Path.IsPathFullyQualified(spec.Cwd) || !Directory.Exists(spec.Cwd))
            throw new ProtocolException("LAUNCH_FAILED");
        var command = new StringBuilder(string.Join(' ', new[] { spec.Executable }.Concat(spec.Arguments).Select(CommandLine.Quote)));
        if (command.Length >= 32767) throw new ProtocolException("LAUNCH_FAILED");
        IntPtr childInput = IntPtr.Zero, childOutput = IntPtr.Zero, childError = IntPtr.Zero;
        IntPtr parentInput = IntPtr.Zero, parentOutput = IntPtr.Zero, parentError = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobs = IntPtr.Zero, environment = IntPtr.Zero;
        var attributesInitialized = false;
        var info = new ProcessInformation();
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            var limits = new JobExtendedLimitInformation { BasicLimitInformation = new JobBasicLimitInformation { LimitFlags = 0x2000 } };
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JobExtendedLimitInformation>()));
            var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), InheritHandle = true };
            Check(CreatePipe(out childInput, out parentInput, ref security, 0));
            Check(CreatePipe(out parentOutput, out childOutput, ref security, 0));
            Check(CreatePipe(out parentError, out childError, ref security, 0));
            foreach (var handle in new[] { parentInput, parentOutput, parentError }) Check(SetHandleInformation(handle, 1, 0));

            nuint size = 0;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(checked((nint)size));
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size));
            attributesInitialized = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handles, 0, childInput);
            Marshal.WriteIntPtr(handles, IntPtr.Size, childOutput);
            Marshal.WriteIntPtr(handles, IntPtr.Size * 2, childError);
            Check(UpdateProcThreadAttribute(attributes, 0, 0x20002, handles, (nuint)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            jobs = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobs, job);
            // JOB_LIST closes the crash window between suspended creation and separate assignment.
            Check(UpdateProcThreadAttribute(attributes, 0, 0x2000D, jobs, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupInformationEx
            {
                Startup = new StartupInformation
                {
                    Size = (uint)Marshal.SizeOf<StartupInformationEx>(), Flags = 0x100,
                    StandardInput = childInput, StandardOutput = childOutput, StandardError = childError
                },
                Attributes = attributes
            };
            var environmentText = string.Join('\0', spec.Environment.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
            environment = Marshal.StringToHGlobalUni(environmentText);
            Check(CreateProcess(spec.Executable, command, IntPtr.Zero, IntPtr.Zero, true,
                0x00000004 | 0x00000400 | 0x00080000, environment, spec.Cwd, ref startup, out info));
            process = info.Process;
            Id = checked((int)info.ProcessId);
            Check(IsProcessInJob(process, job, out var assigned) && assigned);
            Input = Transfer(ref parentInput, FileAccess.Write);
            Output = Transfer(ref parentOutput, FileAccess.Read);
            Error = Transfer(ref parentError, FileAccess.Read);
            Check(ResumeThread(info.Thread) != uint.MaxValue);
        }
        catch
        {
            // Handles are retained until this cleanup; JOB_LIST already owns a successfully created process.
            if (process != IntPtr.Zero) TerminateProcess(process, 1);
            Dispose();
            throw new ProtocolException("LAUNCH_FAILED");
        }
        finally
        {
            Close(ref childInput); Close(ref childOutput); Close(ref childError);
            Close(ref parentInput); Close(ref parentOutput); Close(ref parentError);
            Close(ref info.Thread);
            if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
            foreach (var block in new[] { attributes, handles, jobs, environment }) if (block != IntPtr.Zero) Marshal.FreeHGlobal(block);
        }
    }

    public bool HasExited
    {
        get
        {
            var result = WaitForSingleObject(process, 0);
            if (result == uint.MaxValue) throw new ProtocolException("CLEANUP_FAILED");
            return result == 0;
        }
    }

    public async Task<uint> WaitForExitAsync(CancellationToken cancellationToken)
    {
        while (!HasExited) await Task.Delay(10, cancellationToken);
        if (!GetExitCodeProcess(process, out var code)) throw new ProtocolException("CLEANUP_FAILED");
        return code;
    }

    public void Terminate()
    {
        lock (gate)
        {
            if (terminationRequested) return;
            if (!TerminateJobObject(job, 1)) throw new ProtocolException("CLEANUP_FAILED");
            terminationRequested = true;
        }
    }

    public async Task VerifyEmptyAsync()
    {
        var deadline = Environment.TickCount64 + 5000;
        while (true)
        {
            if (!QueryInformationJobObject(job, 1, out var accounting, (uint)Marshal.SizeOf<JobBasicAccountingInformation>(), IntPtr.Zero))
                throw new ProtocolException("CLEANUP_FAILED");
            if (accounting.ActiveProcesses == 0) return;
            if (Environment.TickCount64 >= deadline) throw new ProtocolException("CLEANUP_FAILED");
            await Task.Delay(10);
        }
    }

    public void Dispose()
    {
        // Closing the private, noninherited job handle is the final kernel-enforced cleanup guard.
        lock (gate) { Close(ref job); }
        Close(ref process);
        Input?.Dispose(); Output?.Dispose(); Error?.Dispose();
    }

    private static FileStream Transfer(ref IntPtr raw, FileAccess access)
    {
        var handle = new SafeFileHandle(raw, true);
        raw = IntPtr.Zero;
        try { return new FileStream(handle, access, 16384, false); }
        catch { handle.Dispose(); throw; }
    }
    private static void Check(bool success) { if (!success) throw new Win32Exception(); }
    private static void Close(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero) return;
        CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential)] private struct JobBasicAccountingInformation
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] private struct JobBasicLimitInformation
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JobExtendedLimitInformation
    {
        public JobBasicLimitInformation BasicLimitInformation; public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInformation
    {
        public uint Size; public IntPtr Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public ushort ShowWindow, Reserved2Size; public IntPtr Reserved2, StandardInput, StandardOutput, StandardError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInformationEx { public StartupInformation Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref JobExtendedLimitInformation information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, nuint attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInformationEx startup, out ProcessInformation information);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out JobBasicAccountingInformation information, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
