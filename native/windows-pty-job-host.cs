using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class WindowsPtyJobHost
{
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint PROCESS_SET_QUOTA = 0x00000100;
    private const uint PROCESS_TERMINATE = 0x00000001;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint INFINITE = 0xffffffff;

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JobObjectExtendedLimitInformation information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(
        uint count,
        IntPtr[] handles,
        bool waitAll,
        uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int Main(string[] args)
    {
        uint ownerPid;
        uint targetPid;
        if (args.Length != 2 ||
            !uint.TryParse(args[0], out ownerPid) ||
            !uint.TryParse(args[1], out targetPid))
        {
            Console.Error.WriteLine("Usage: windows-pty-job-host <owner-pid> <target-pid>");
            return 2;
        }

        IntPtr owner = IntPtr.Zero;
        IntPtr target = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        try
        {
            owner = OpenProcess(SYNCHRONIZE, false, ownerPid);
            Ensure(owner != IntPtr.Zero, "Unable to monitor the Obsidian process");
            target = OpenProcess(SYNCHRONIZE | PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, targetPid);
            Ensure(target != IntPtr.Zero, "Unable to open the Windows PTY host");

            job = CreateJobObject(IntPtr.Zero, null);
            Ensure(job != IntPtr.Zero, "Unable to create the PTY job object");
            var limits = new JobObjectExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            Ensure(SetInformationJobObject(job, 9, ref limits,
                (uint)Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation))),
                "Unable to configure the PTY job object");
            Ensure(AssignProcessToJobObject(job, target),
                "Unable to assign the Windows PTY host to its job object");

            Console.Out.WriteLine("ready");
            Console.Out.Flush();
            uint result = WaitForMultipleObjects(2, new[] { owner, target }, false, INFINITE);
            if (result == WAIT_OBJECT_0) return 0;
            Ensure(result == WAIT_OBJECT_0 + 1, "Unable to monitor the Windows PTY host");
            uint exitCode;
            Ensure(GetExitCodeProcess(target, out exitCode),
                "Unable to read the Windows PTY host exit code");
            return unchecked((int)exitCode);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (target != IntPtr.Zero) CloseHandle(target);
            if (owner != IntPtr.Zero) CloseHandle(owner);
        }
    }

    private static void Ensure(bool success, string message)
    {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), message);
    }
}
