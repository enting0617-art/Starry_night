import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, projectRoot } from '../config.js';

const composeFile = 'docker-compose.search.yml';
const settingsPath = join(projectRoot, 'searxng', 'settings.yml');
const localConfigPath = join(projectRoot, 'config.local.json');
const outputLimit = 128 * 1024;

function runDocker(args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let child;
    try {
      child = spawn('docker', args, { cwd: projectRoot, windowsHide: true, shell: false, env: process.env });
    } catch (error) {
      resolve({ ok: false, exitCode: 1, stdout: '', stderr: error.message, durationMs: Math.round(performance.now() - startedAt) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-outputLimit); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-outputLimit); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: 1, stdout, stderr: `${stderr}${error.message}`, durationMs: Math.round(performance.now() - startedAt) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\nDocker 命令超时，已停止。`.trim() : stderr,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}

function composeArgs(...args) {
  return ['compose', '-f', composeFile, ...args];
}

export function isSearxngSecretConfigured(settings) {
  const match = String(settings || '').match(/^\s*secret_key:\s*["']?([^"'\s#]+)["']?/m);
  const key = match?.[1] || '';
  return key.length >= 32 && !/change_me|replace|example/i.test(key);
}

async function readSettings() {
  try {
    return await readFile(settingsPath, 'utf8');
  } catch {
    return '';
  }
}

async function initializeSecret() {
  const settings = await readSettings();
  if (!settings) throw new Error('找不到 searxng/settings.yml。');
  if (isSearxngSecretConfigured(settings)) return false;
  const secret = randomBytes(32).toString('hex');
  const updated = settings.replace(/^(\s*secret_key:\s*)["']?[^"'\s#]+["']?/m, `$1"${secret}"`);
  if (updated === settings) throw new Error('无法找到 SearXNG 的 secret_key 配置。');
  await writeFile(settingsPath, updated, 'utf8');
  return true;
}

async function enableLocalProvider() {
  let localConfig = {};
  try {
    localConfig = JSON.parse(await readFile(localConfigPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取 config.local.json：${error.message}`);
  }
  const updated = {
    ...localConfig,
    webSearch: { ...(localConfig.webSearch || {}), enabled: true, provider: 'searxng', endpoint: 'http://127.0.0.1:8888' },
    search: { ...(localConfig.search || {}), agentEnabled: true },
  };
  await writeFile(localConfigPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

function localEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function probeService(endpoint) {
  const origin = localEndpoint(endpoint);
  if (!origin) return { ok: false, detail: '当前搜索地址不是本机 SearXNG，未执行本机健康检查。' };
  try {
    const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3_500) });
    return { ok: response.ok, detail: response.ok ? '本机服务响应正常。' : `本机服务返回 HTTP ${response.status}。` };
  } catch (error) {
    return { ok: false, detail: `暂时无法访问本机服务：${error.message}` };
  }
}

export async function getSearxngStatus() {
  const [config, settings, docker] = await Promise.all([
    loadConfig(),
    readSettings(),
    runDocker(['compose', 'version'], 8_000),
  ]);
  const running = docker.ok
    ? await runDocker(composeArgs('ps', '--status', 'running', '--services'), 10_000)
    : { ok: false, stdout: '', stderr: docker.stderr };
  const endpoint = 'http://127.0.0.1:8888';
  const service = await probeService(endpoint);
  const runningServices = running.ok ? running.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  return {
    dockerAvailable: docker.ok,
    dockerDetail: docker.ok ? docker.stdout.trim() || 'Docker Compose 已就绪。' : (docker.stderr || '未检测到 Docker Desktop。').trim(),
    settingsReady: isSearxngSecretConfigured(settings),
    serviceRunning: runningServices.includes('searxng'),
    serviceReady: service.ok,
    serviceDetail: service.detail,
    endpoint,
    configuredEndpoint: config.webSearch?.endpoint || '',
    providerEnabled: config.webSearch?.provider === 'searxng',
  };
}

export async function runSearxngAction(action) {
  const allowed = new Map([
    ['initialize', ['up', '-d']],
    ['start', ['up', '-d']],
    ['stop', ['stop']],
    ['restart', ['restart']],
    ['enable', null],
  ]);
  if (!allowed.has(action)) throw new Error('不支持的 SearXNG 操作。');
  if (action === 'enable') {
    await enableLocalProvider();
    return { action, result: { stdout: '已写入 config.local.json。本地搜索将使用 SearXNG；无需重启服务。', stderr: '' }, status: await getSearxngStatus() };
  }
  if (action === 'initialize') await initializeSecret();
  if (action !== 'stop' && !isSearxngSecretConfigured(await readSettings())) {
    throw new Error('请先在 searxng/settings.yml 设置一个随机的 secret_key，再启动 SearXNG。');
  }
  const result = await runDocker(composeArgs(...allowed.get(action)), action === 'start' ? 60_000 : 25_000);
  if (!result.ok) throw new Error((result.stderr || result.stdout || 'Docker 操作失败。').trim());
  return { action, result, status: await getSearxngStatus() };
}

export async function getSearxngLogs() {
  const result = await runDocker(composeArgs('logs', '--tail', '80', 'searxng'), 15_000);
  if (!result.ok) throw new Error((result.stderr || result.stdout || '无法读取 SearXNG 日志。').trim());
  return { output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || '暂时没有日志。', durationMs: result.durationMs };
}
