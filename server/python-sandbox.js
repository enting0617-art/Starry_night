import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot } from './config.js';

const root = resolve(projectRoot, 'data', 'sandbox', 'python');
const image = 'python:3.12-alpine';
const allowedModules = new Set(['math', 'statistics', 'random', 'itertools', 'collections', 'functools', 're', 'json', 'csv', 'datetime', 'decimal', 'fractions', 'string', 'textwrap']);
const forbidden = /(?:__|\b(?:open|exec|eval|compile|globals|locals|vars|getattr|setattr|delattr|input|breakpoint|help|dir)\s*\(|\b(?:os|sys|subprocess|socket|http|urllib|requests|pathlib|shutil|ctypes|multiprocessing|threading|asyncio|importlib|pickle|marshal|sqlite3)\b)/iu;

function safeFileName(value) {
  const name = String(value || '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}\.py$/u.test(name)) throw new Error('Python 文件名只能使用英文字母、数字、_、-，并以 .py 结尾。');
  return name;
}

function run(command, args, { timeoutMs = 10_000, maxOutput = 24_000 } = {}) {
  return new Promise((resolveResult) => {
    let stdout = ''; let stderr = ''; let timedOut = false;
    const child = spawn(command, args, { windowsHide: true, shell: false });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < maxOutput) stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (stderr.length < maxOutput) stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); resolveResult({ ok: false, code: -1, stdout, stderr: error.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolveResult({ ok: code === 0 && !timedOut, code, stdout: stdout.slice(0, maxOutput), stderr: stderr.slice(0, maxOutput), timedOut }); });
  });
}

export function auditPythonSource({ fileName, source }) {
  const errors = [];
  let safeName = '';
  try { safeName = safeFileName(fileName); } catch (error) { errors.push(error.message); }
  const text = String(source || '').replace(/\r\n?/gu, '\n');
  if (!text.trim()) errors.push('Python 文件不能为空。');
  if (text.length > 32_000) errors.push('Python 文件不能超过 32 KB。');
  if (forbidden.test(text)) errors.push('检测到受限的文件、进程、网络、反射或动态执行能力。');
  for (const match of text.matchAll(/^\s*(?:from\s+([a-zA-Z_][\w.]*)\s+import|import\s+([a-zA-Z_][\w.]*))/gmu)) {
    const moduleName = (match[1] || match[2] || '').split('.')[0];
    if (!allowedModules.has(moduleName)) errors.push(`不允许导入模块：${moduleName}`);
  }
  if (/^\s*(?:from|import)\s+/mu.test(text) && !text.match(/^\s*(?:from|import)\s+/mu)) errors.push('导入语句格式无效。');
  return { ok: !errors.length, fileName: safeName, source: text, errors, policy: { image, network: false, readOnly: true, memoryMb: 256, timeoutSeconds: 12 } };
}

export async function getPythonSandboxStatus() {
  const docker = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 6_000, maxOutput: 2_000 });
  const imageReady = docker.ok ? await run('docker', ['image', 'inspect', image], { timeoutMs: 8_000, maxOutput: 2_000 }) : { ok: false };
  return { dockerReady: docker.ok, dockerDetail: (docker.ok ? docker.stdout : docker.stderr).trim(), image, imageReady: imageReady.ok, canRun: docker.ok && imageReady.ok, policy: { network: 'disabled', filesystem: 'read-only', memoryMb: 256, cpu: 0.5, pids: 64, timeoutSeconds: 12 } };
}

export async function runPythonInSandbox({ fileName, source }) {
  const audit = auditPythonSource({ fileName, source });
  if (!audit.ok) return { ran: false, audit, error: '安全审计未通过，文件没有被运行。' };
  const status = await getPythonSandboxStatus();
  if (!status.canRun) return { ran: false, audit, status, error: status.dockerReady ? 'Python 隔离镜像尚未准备好。' : 'Docker 隔离环境不可用；为安全起见不会在宿主机运行 Python。' };
  const runId = `${Date.now()}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const runDirectory = resolve(root, 'runs', runId);
  if (!relative(root, runDirectory) || relative(root, runDirectory).startsWith('..')) throw new Error('沙盒目录校验失败。');
  await mkdir(runDirectory, { recursive: true });
  const sourcePath = join(runDirectory, audit.fileName);
  await writeFile(sourcePath, audit.source, 'utf8');
  const result = await run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m', '-v', `${runDirectory}:/work:ro`, '-w', '/work', image, 'python', '-I', '-B', audit.fileName], { timeoutMs: 12_000 });
  return { ran: true, audit, status, fileName: audit.fileName, exitCode: result.code, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr };
}
