using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;

// Deliberately small broker: JSON in on stdin, JSON out on stdout. It never invokes a shell.
public static class StarrySandbox {
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, CREATE_SUSPENDED = 0x00000004;
  const int ProcThreadAttributeHandleList = 0x00020002, ProcThreadAttributeSecurityCapabilities = 0x00020009, ProcThreadAttributeChildProcessPolicy = 0x0002000E;
  const uint HandleFlagInherit = 1, JobObjectExtendedLimitInformation = 9, JobObjectBasicUIRestrictions = 4, JobObjectCpuRateControlInformation = 15;
  const uint JobLimitProcessMemory = 0x100, JobLimitJobMemory = 0x200, JobLimitActiveProcess = 0x8, JobLimitKillOnClose = 0x2000;
  const uint JobCpuEnable = 0x1, JobCpuHardCap = 0x4, ChildProcessRestricted = 0x1;
  const uint UiAll = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80;
  const string ProfileName = "StarryNight.PythonSandbox";

  [StructLayout(LayoutKind.Sequential)] struct SA { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SI { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct SecurityCapabilities { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize, ActiveProcessLimit; public IntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct CpuLimit { public uint ControlFlags, CpuRate; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SIX si, out PI pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SA sa, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, uint cls, IntPtr data, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr caps, uint capCount, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);

  public static int Main() {
    Console.InputEncoding = Encoding.UTF8;
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      var request = Request.Parse(Console.In.ReadToEnd());
      var result = Execute(request);
      Console.Out.Write(result.Json());
      return result.Ok ? 0 : 1;
    } catch (Exception error) {
      Console.Out.Write(Result.Fail("broker_error", error.Message).Json());
      return 1;
    }
  }

  static Result Execute(Request r) {
    if (!File.Exists(r.PythonPath) || !r.PythonPath.EndsWith("python.exe", StringComparison.OrdinalIgnoreCase)) return Result.Fail("invalid_runtime", "受限 Python runtime 不存在：" + r.PythonPath);
    if (r.Code.Length == 0 || r.Code.Length > 32768) return Result.Fail("invalid_code", "代码为空或超过 32 KB。");
    if (r.TimeoutMs < 100 || r.TimeoutMs > 60000 || r.MemoryBytes < 32 * 1024 * 1024 || r.MemoryBytes > 2L * 1024 * 1024 * 1024 || r.MaxOutputBytes < 1024 || r.MaxOutputBytes > 1024 * 1024) return Result.Fail("invalid_limits", "沙盒限制参数无效。");
    var root = Path.GetFullPath(r.WorkspaceRoot); var run = Path.Combine(root, Guid.NewGuid().ToString("N"));
    if (!run.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return Result.Fail("invalid_workspace", "工作目录校验失败。");
    Directory.CreateDirectory(run); File.WriteAllText(Path.Combine(run, "main.py"), r.Code, new UTF8Encoding(false));
    IntPtr appSid = EnsureProfile();
    if (appSid == IntPtr.Zero) return Result.Fail("appcontainer_unavailable", "无法建立 Windows AppContainer profile。");
    try {
      Grant(new FileInfo(r.PythonPath).DirectoryName, appSid, FileSystemRights.ReadAndExecute, AccessControlType.Allow);
      DenyWrite(new FileInfo(r.PythonPath).DirectoryName, appSid);
      Grant(run, appSid, FileSystemRights.Modify, AccessControlType.Allow);
      return Launch(r, run, appSid);
    } finally { FreeSid(appSid); }
  }

  static IntPtr EnsureProfile() {
    IntPtr sid; int hr = CreateAppContainerProfile(ProfileName, "Starry Night Python Sandbox", "No-network Python execution", IntPtr.Zero, 0, out sid);
    if (hr == 0) return sid;
    hr = DeriveAppContainerSidFromAppContainerName(ProfileName, out sid);
    return hr == 0 ? sid : IntPtr.Zero;
  }

  static void Grant(string path, IntPtr sid, FileSystemRights rights, AccessControlType type) {
    var security = Directory.GetAccessControl(path);
    var identity = new SecurityIdentifier(sid);
    var matching = new List<FileSystemAccessRule>();
    foreach (FileSystemAccessRule existing in security.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
      if (existing.IdentityReference.Value == identity.Value && existing.AccessControlType == type) matching.Add(existing);
    }
    if (matching.Count == 1 && matching[0].FileSystemRights == rights) return;
    foreach (FileSystemAccessRule existing in matching) security.RemoveAccessRuleSpecific(existing);
    security.AddAccessRule(new FileSystemAccessRule(identity, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, type));
    Directory.SetAccessControl(path, security);
  }
  static void DenyWrite(string path, IntPtr sid) { Grant(path, sid, FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership, AccessControlType.Deny); }

  static Result Launch(Request r, string run, IntPtr sid) {
    IntPtr job = IntPtr.Zero, outRead = IntPtr.Zero, outWrite = IntPtr.Zero, errRead = IntPtr.Zero, errWrite = IntPtr.Zero, list = IntPtr.Zero, securityPtr = IntPtr.Zero, handlesPtr = IntPtr.Zero, childPolicyPtr = IntPtr.Zero;
    PI pi = new PI(); bool created = false;
    try {
      job = CreateJobObject(IntPtr.Zero, null); if (job == IntPtr.Zero) return Result.Fail("job_error", "无法创建 Job Object。");
      SetJobLimits(job, r);
      var sa = new SA { nLength = Marshal.SizeOf(typeof(SA)), bInheritHandle = true };
      if (!CreatePipe(out outRead, out outWrite, ref sa, 0) || !CreatePipe(out errRead, out errWrite, ref sa, 0)) return Result.Fail("pipe_error", "无法创建受控输出管道。");
      SetHandleInformation(outRead, HandleFlagInherit, 0); SetHandleInformation(errRead, HandleFlagInherit, 0);
      IntPtr bytes = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 3, 0, ref bytes); list = Marshal.AllocHGlobal(bytes); if (!InitializeProcThreadAttributeList(list, 3, 0, ref bytes)) return Result.Fail("attribute_error", "无法初始化进程安全属性。");
      var capabilities = new SecurityCapabilities { AppContainerSid = sid }; securityPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecurityCapabilities))); Marshal.StructureToPtr(capabilities, securityPtr, false);
      if (!UpdateProcThreadAttribute(list, 0, (IntPtr)ProcThreadAttributeSecurityCapabilities, securityPtr, (IntPtr)Marshal.SizeOf(typeof(SecurityCapabilities)), IntPtr.Zero, IntPtr.Zero)) return Result.Fail("security_attribute_error", "无法设置 AppContainer 安全属性。");
      handlesPtr = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handlesPtr, 0, outWrite); Marshal.WriteIntPtr(handlesPtr, IntPtr.Size, errWrite);
      if (!UpdateProcThreadAttribute(list, 0, (IntPtr)ProcThreadAttributeHandleList, handlesPtr, (IntPtr)(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero)) return Result.Fail("handle_attribute_error", "无法限制继承 handle。");
      childPolicyPtr = Marshal.AllocHGlobal(sizeof(uint)); Marshal.WriteInt32(childPolicyPtr, (int)ChildProcessRestricted);
      if (!UpdateProcThreadAttribute(list, 0, (IntPtr)ProcThreadAttributeChildProcessPolicy, childPolicyPtr, (IntPtr)sizeof(uint), IntPtr.Zero, IntPtr.Zero)) return Result.Fail("child_policy_error", "无法设置子进程限制。");
      var si = new SIX(); si.StartupInfo.cb = Marshal.SizeOf(typeof(SIX)); si.StartupInfo.dwFlags = 0x00000100; si.StartupInfo.hStdOutput = outWrite; si.StartupInfo.hStdError = errWrite; si.lpAttributeList = list;
      var command = new StringBuilder("\"" + r.PythonPath + "\" -I -B -S \"main.py\"");
      created = CreateProcess(r.PythonPath, command, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, IntPtr.Zero, run, ref si, out pi);
      CloseHandle(outWrite); outWrite = IntPtr.Zero; CloseHandle(errWrite); errWrite = IntPtr.Zero;
      if (!created) return Result.Fail("launch_error", "AppContainer Python 未能启动，Win32 error " + Marshal.GetLastWin32Error());
      if (!AssignProcessToJobObject(job, pi.hProcess)) return Result.Fail("job_assign_error", "无法将 Python 加入受限 Job。");
      var outTask = Drain(outRead, r.MaxOutputBytes); var errTask = Drain(errRead, r.MaxOutputBytes); ResumeThread(pi.hThread);
      bool timedOut = WaitForSingleObject(pi.hProcess, (uint)r.TimeoutMs) == 258; if (timedOut) TerminateJobObject(job, 124);
      Task.WaitAll(outTask, errTask); uint exit; GetExitCodeProcess(pi.hProcess, out exit);
      return new Result { Ok = !timedOut && exit == 0, ExitCode = exit, TimedOut = timedOut, Stdout = outTask.Result.Text, Stderr = errTask.Result.Text, StdoutTruncated = outTask.Result.Truncated, StderrTruncated = errTask.Result.Truncated, Backend = "appcontainer-job" };
    } finally {
      if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread); if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
      if (outRead != IntPtr.Zero) CloseHandle(outRead); if (outWrite != IntPtr.Zero) CloseHandle(outWrite); if (errRead != IntPtr.Zero) CloseHandle(errRead); if (errWrite != IntPtr.Zero) CloseHandle(errWrite);
      if (list != IntPtr.Zero) { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); } if (securityPtr != IntPtr.Zero) Marshal.FreeHGlobal(securityPtr); if (handlesPtr != IntPtr.Zero) Marshal.FreeHGlobal(handlesPtr); if (childPolicyPtr != IntPtr.Zero) Marshal.FreeHGlobal(childPolicyPtr); if (job != IntPtr.Zero) CloseHandle(job);
    }
  }

  static void SetJobLimits(IntPtr job, Request r) {
    var limit = new ExtendedLimit(); limit.BasicLimitInformation.LimitFlags = JobLimitProcessMemory | JobLimitJobMemory | JobLimitActiveProcess | JobLimitKillOnClose; limit.BasicLimitInformation.ActiveProcessLimit = (UIntPtr)1; limit.ProcessMemoryLimit = (UIntPtr)(ulong)r.MemoryBytes; limit.JobMemoryLimit = (UIntPtr)(ulong)r.MemoryBytes;
    IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ExtendedLimit))); Marshal.StructureToPtr(limit, p, false); try { if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, p, (uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("Job memory limit error " + Marshal.GetLastWin32Error()); } finally { Marshal.FreeHGlobal(p); }
    var cpu = new CpuLimit { ControlFlags = JobCpuEnable | JobCpuHardCap, CpuRate = 5000 }; p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CpuLimit))); Marshal.StructureToPtr(cpu, p, false); try { SetInformationJobObject(job, JobObjectCpuRateControlInformation, p, (uint)Marshal.SizeOf(typeof(CpuLimit))); } finally { Marshal.FreeHGlobal(p); }
    p = Marshal.AllocHGlobal(sizeof(uint)); Marshal.WriteInt32(p, (int)UiAll); try { SetInformationJobObject(job, JobObjectBasicUIRestrictions, p, sizeof(uint)); } finally { Marshal.FreeHGlobal(p); }
  }

  class Captured { public string Text; public bool Truncated; }
  static Task<Captured> Drain(IntPtr handle, int max) { return Task.Factory.StartNew(() => { using (var stream = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(handle, false), FileAccess.Read)) using (var reader = new StreamReader(stream, Encoding.UTF8)) { var buffer = new char[4096]; var sb = new StringBuilder(); int n; bool cut = false; while ((n = reader.Read(buffer, 0, buffer.Length)) > 0) { int room = max - Encoding.UTF8.GetByteCount(sb.ToString()); if (room <= 0) { cut = true; continue; } string piece = new string(buffer, 0, n); if (Encoding.UTF8.GetByteCount(piece) > room) { sb.Append(piece.Substring(0, Math.Min(piece.Length, room))); cut = true; } else sb.Append(piece); } return new Captured { Text = sb.ToString(), Truncated = cut }; } }); }

  class Request { public string PythonPath = "", WorkspaceRoot = "", Code = ""; public int TimeoutMs = 12000, MaxOutputBytes = 1048576; public long MemoryBytes = 268435456; public static Request Parse(string json) { return new Request { PythonPath = Get(json, "pythonPath"), WorkspaceRoot = Get(json, "workspaceRoot"), Code = Get(json, "code"), TimeoutMs = GetInt(json, "timeoutMs", 12000), MaxOutputBytes = GetInt(json, "maxOutputBytes", 1048576), MemoryBytes = GetLong(json, "memoryBytes", 268435456) }; } static string Get(string s, string key) { var m = System.Text.RegularExpressions.Regex.Match(s, "\\\"" + key + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\""); return m.Success ? JsonUnescape(m.Groups[1].Value) : ""; } static int GetInt(string s, string k, int d) { int n; return Int32.TryParse(System.Text.RegularExpressions.Regex.Match(s, "\\\"" + k + "\\\"\\s*:\\s*(\\d+)").Groups[1].Value, out n) ? n : d; } static long GetLong(string s, string k, long d) { long n; return Int64.TryParse(System.Text.RegularExpressions.Regex.Match(s, "\\\"" + k + "\\\"\\s*:\\s*(\\d+)").Groups[1].Value, out n) ? n : d; } static string JsonUnescape(string v) { var b = new StringBuilder(); for (int i = 0; i < v.Length; i++) { if (v[i] != '\\' || i + 1 >= v.Length) { b.Append(v[i]); continue; } char c = v[++i]; if (c == 'n') b.Append('\n'); else if (c == 'r') b.Append('\r'); else if (c == 't') b.Append('\t'); else if (c == 'b') b.Append('\b'); else if (c == 'f') b.Append('\f'); else if (c == 'u' && i + 4 < v.Length) { int n; if (Int32.TryParse(v.Substring(i + 1, 4), System.Globalization.NumberStyles.HexNumber, null, out n)) { b.Append((char)n); i += 4; } } else b.Append(c); } return b.ToString(); } }
  class Result { public bool Ok; public uint ExitCode; public bool TimedOut, StdoutTruncated, StderrTruncated; public string Stdout = "", Stderr = "", Error = "", Backend = ""; public static Result Fail(string code, string message) { return new Result { Ok = false, Error = code + ": " + message, Backend = "none" }; } public string Json() { return "{\"ok\":" + (Ok ? "true" : "false") + ",\"exitCode\":" + ExitCode + ",\"timedOut\":" + (TimedOut ? "true" : "false") + ",\"stdoutTruncated\":" + (StdoutTruncated ? "true" : "false") + ",\"stderrTruncated\":" + (StderrTruncated ? "true" : "false") + ",\"backend\":\"" + Esc(Backend) + "\",\"stdout\":\"" + Esc(Stdout) + "\",\"stderr\":\"" + Esc(Stderr) + "\",\"error\":\"" + Esc(Error) + "\"}"; } static string Esc(string v) { return (v ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n"); } }
}
