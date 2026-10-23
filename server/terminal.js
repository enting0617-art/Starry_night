import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { projectRoot } from './config.js';

const HELP = `可用命令：
  help                 显示此帮助
  status               显示服务与 Ollama 配置摘要
  config               显示当前非敏感配置
  project files        列出项目文件
  node --version       显示 Node.js 版本
  npm --version        显示 npm 版本
  ollama --version     显示 Ollama 版本
  ollama list          列出本地模型
  ollama ps            列出运行中的模型
  ollama show <模型>   显示模型信息

为了安全，此终端不使用系统 shell，不支持删除、管道、重定向或任意程序。`;

function tokenize(input) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(input)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

async function listFiles(directory, prefix = '', depth = 0) {
  if (depth > 3) return [];
  const ignored = new Set(['node_modules', 'dist', '.git']);
  const entries = await readdir(directory, { withFileTypes: true });
  const lines = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const marker = entry.isDirectory() ? '/' : '';
    lines.push(`${prefix}${entry.name}${marker}`);
    if (entry.isDirectory()) lines.push(...await listFiles(join(directory, entry.name), `${prefix}  `, depth + 1));
  }
  return lines;
}

function runProcess(executable, args, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let child;
    try {
      child = spawn(executable, args, {
        cwd: projectRoot,
        windowsHide: true,
        shell: false,
        env: process.env,
      });
    } catch (error) {
      resolve({ exitCode: 1, stdout: '', stderr: error.message, durationMs: Math.round(performance.now() - startedAt) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const limit = 256 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-limit); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-limit); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, durationMs: Math.round(performance.now() - startedAt) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\n命令超过配置的超时时间，已终止。`.trim() : stderr,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}

export async function runDiagnosticCommand(input, config) {
  const command = String(input || '').trim();
  const tokens = tokenize(command);
  const normalized = tokens.map((token) => token.toLowerCase());
  const startedAt = performance.now();
  const internal = (stdout, exitCode = 0) => ({ exitCode, stdout, stderr: '', durationMs: Math.round(performance.now() - startedAt) });

  if (!tokens.length || normalized[0] === 'help') return internal(HELP);
  if (normalized.join(' ') === 'node --version') return internal(process.version);
  if (normalized.join(' ') === 'status') {
    return internal([
      `project: ${relative(process.cwd(), projectRoot) || '.'}`,
      `server: http://${config.server.host}:${config.server.port}`,
      `ollama: ${config.ollamaBaseUrl}`,
      `default model: ${config.defaultModel || '(auto)'}`,
      `uptime: ${Math.round(process.uptime())}s`,
    ].join('\n'));
  }
  if (normalized.join(' ') === 'config') {
    return internal(JSON.stringify({
      appName: config.appName,
      ollamaBaseUrl: config.ollamaBaseUrl,
      defaultModel: config.defaultModel,
      temperature: config.temperature,
      debug: config.debug,
      server: config.server,
    }, null, 2));
  }
  if (normalized.join(' ') === 'project files') return internal((await listFiles(projectRoot)).join('\n'));
  if (normalized.join(' ') === 'npm --version') {
    if (process.platform === 'win32') {
      const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      return runProcess(process.execPath, [npmCli, '--version'], Math.min(config.debug.requestTimeoutMs, 10000));
    }
    return runProcess('npm', ['--version'], Math.min(config.debug.requestTimeoutMs, 10000));
  }
  if (normalized[0] === 'ollama') {
    const allowed = normalized.length === 2 && ['--version', 'list', 'ps'].includes(normalized[1]);
    const show = normalized[1] === 'show' && tokens.length === 3;
    if (allowed || show) return runProcess('ollama', tokens.slice(1), config.debug.requestTimeoutMs);
  }

  return internal(`命令不在安全白名单中。输入 help 查看可用命令。`, 126);
}
