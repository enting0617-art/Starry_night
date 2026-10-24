import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot } from './config.js';

const helperPath = join(projectRoot, 'runtime', 'sandbox', 'starry-sandbox.exe');
const runtimeCandidates = [
  join(projectRoot, 'runtime', 'python', 'python.exe'),
  join(projectRoot, 'GPT-SoVITS-v3lora-20250228', 'runtime', 'python.exe'),
];
const forbidden = /(?:\b(?:open|exec|eval|compile|globals|locals|vars|getattr|setattr|delattr|input|breakpoint)\s*\(|\b(?:subprocess|socket|http|urllib|requests|pathlib|shutil|ctypes|multiprocessing|threading|asyncio|importlib|pickle|marshal|sqlite3)\b)/iu;

function safeFileName(value) {
  const name = String(value || '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}\.py$/u.test(name)) throw new Error('Python 文件名只能使用英文字母、数字、_、-，并以 .py 结尾。');
  return name;
}

function pythonRuntimePath() { return runtimeCandidates.find(existsSync) || ''; }

function runHelper(request) {
  return new Promise((resolveResult) => {
    const child = spawn(helperPath, [], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; let timedOut = false;
    // The Python Job itself has the strict 12-second limit. Keep the broker watchdog longer
    // so first-run AppContainer profile/ACL setup cannot be mistaken for user-code runtime.
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.min(70_000, Number(request.timeoutMs || 12_000) + 55_000));
    child.stdout.on('data', (chunk) => { if (output.length < 2_300_000) output += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); resolveResult({ ok: false, error: `无法启动原生沙盒：${error.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return resolveResult({ ok: false, timedOut: true, error: '原生沙盒 broker 超时，已终止。' });
      try { resolveResult(JSON.parse(output)); } catch { resolveResult({ ok: false, error: `原生沙盒返回无效数据：${output.slice(0, 500) || '没有输出'}` }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function auditPythonSource({ fileName, source }) {
  const errors = [];
  let safeName = '';
  try { safeName = safeFileName(fileName); } catch (error) { errors.push(error.message); }
  const text = String(source || '').replace(/\r\n?/gu, '\n');
  if (!text.trim()) errors.push('Python 文件不能为空。');
  if (text.length > 32_000) errors.push('Python 文件不能超过 32 KB。');
  if (forbidden.test(text)) errors.push('静态审计检测到危险能力；严格模式拒绝执行。');
  return { ok: !errors.length, fileName: safeName, source: text, errors, policy: { backend: 'windows-appcontainer-job', network: false, filesystem: 'isolated-workspace', memoryMb: 256, timeoutSeconds: 12, maxOutputBytes: 1_048_576 } };
}

export async function getPythonSandboxStatus() {
  const pythonPath = pythonRuntimePath();
  const helperReady = existsSync(helperPath);
  return {
    backend: 'windows-appcontainer-job', helperReady, helperPath: helperReady ? helperPath : '', pythonRuntimeReady: Boolean(pythonPath), pythonPath: pythonPath || '',
    canRun: helperReady && Boolean(pythonPath),
    detail: helperReady && pythonPath ? '原生 AppContainer + Job Object 沙盒已就绪。' : !helperReady ? '原生沙盒 helper 尚未构建。' : '受限 Python runtime 尚未随项目提供。',
    policy: { network: 'AppContainer 无 network capability', filesystem: '仅 AppContainer workspace', memoryMb: 256, cpu: '50%', processes: 1, timeoutSeconds: 12, maxOutputBytes: 1_048_576 },
  };
}

export async function runPythonInSandbox({ fileName, source }) {
  const audit = auditPythonSource({ fileName, source });
  if (!audit.ok) return { ran: false, audit, error: '安全审计未通过，代码没有写入或运行。' };
  const status = await getPythonSandboxStatus();
  if (!status.canRun) return { ran: false, audit, status, error: '原生 Windows 沙盒尚未就绪；为安全起见不会在宿主机运行 Python。' };
  const workspaceRoot = resolve(projectRoot, 'data', 'sandbox', 'python');
  const result = await runHelper({ pythonPath: status.pythonPath, workspaceRoot, code: audit.source, timeoutMs: 12_000, memoryBytes: 256 * 1024 * 1024, maxOutputBytes: 1_048_576 });
  return {
    ran: result.backend === 'appcontainer-job', audit, status, fileName: audit.fileName,
    exitCode: result.exitCode ?? -1, timedOut: result.timedOut === true, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''),
    stdoutTruncated: result.stdoutTruncated === true, stderrTruncated: result.stderrTruncated === true, backend: result.backend || 'none', error: result.error || '',
  };
}
