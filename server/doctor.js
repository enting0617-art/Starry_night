import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, projectRoot } from './config.js';

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function check(name, ok, detail, durationMs = 0) {
  return { name, ok, detail, durationMs };
}

async function requestJson(url, timeoutMs) {
  const startedAt = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data, durationMs: Math.round(performance.now() - startedAt) };
}

export async function runDoctor({ network = true } = {}) {
  const startedAt = new Date();
  const checks = [];
  let config;
  try {
    config = await loadConfig();
    checks.push(check('config', true, '配置格式与取值有效'));
  } catch (error) {
    checks.push(check('config', false, error.message));
    return {
      schemaVersion: 1,
      status: 'error',
      generatedAt: startedAt.toISOString(),
      environment: { node: process.version, platform: process.platform, architecture: process.arch },
      checks,
    };
  }

  const [packageReady, buildReady] = await Promise.all([
    fileExists(join(projectRoot, 'package.json')),
    fileExists(join(projectRoot, 'dist', 'index.html')),
  ]);
  checks.push(check('project', packageReady, packageReady ? '项目文件完整' : '缺少 package.json'));
  checks.push(check('build', buildReady, buildReady ? '生产构建已存在' : '尚未构建，请运行 npm run build'));

  const ollama = { baseUrl: config.ollamaBaseUrl, reachable: false, version: null, installedModels: [], runningModels: [] };
  if (network) {
    const timeoutMs = Math.min(config.debug.requestTimeoutMs, 5000);
    const results = await Promise.allSettled([
      requestJson(`${config.ollamaBaseUrl}/api/version`, timeoutMs),
      requestJson(`${config.ollamaBaseUrl}/api/tags`, timeoutMs),
      requestJson(`${config.ollamaBaseUrl}/api/ps`, timeoutMs),
    ]);
    const [versionResult, tagsResult, psResult] = results;
    const successful = results.filter((item) => item.status === 'fulfilled' && item.value.ok);
    ollama.reachable = successful.length > 0;

    if (versionResult.status === 'fulfilled') {
      ollama.version = versionResult.value.data.version || null;
      checks.push(check('ollama.version', versionResult.value.ok, ollama.version || `HTTP ${versionResult.value.status}`, versionResult.value.durationMs));
    } else checks.push(check('ollama.version', false, versionResult.reason?.message || '连接失败'));

    if (tagsResult.status === 'fulfilled') {
      ollama.installedModels = (tagsResult.value.data.models || []).map((model) => model.name || model.model);
      checks.push(check('ollama.models', tagsResult.value.ok, `${ollama.installedModels.length} 个已安装模型`, tagsResult.value.durationMs));
    } else checks.push(check('ollama.models', false, tagsResult.reason?.message || '连接失败'));

    if (psResult.status === 'fulfilled') {
      ollama.runningModels = (psResult.value.data.models || []).map((model) => model.name || model.model);
      checks.push(check('ollama.running', psResult.value.ok, `${ollama.runningModels.length} 个运行中模型`, psResult.value.durationMs));
    } else checks.push(check('ollama.running', false, psResult.reason?.message || '连接失败'));
  } else {
    checks.push(check('ollama.network', true, '按参数跳过网络检查'));
  }

  const failures = checks.filter((item) => !item.ok);
  return {
    schemaVersion: 1,
    status: failures.length ? (checks.some((item) => item.name === 'config' && !item.ok) ? 'error' : 'degraded') : 'healthy',
    generatedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, pid: process.pid },
    server: { host: config.server.host, port: config.server.port, uptimeSeconds: Math.round(process.uptime()) },
    config: {
      appName: config.appName,
      defaultModel: config.defaultModel,
      temperature: config.temperature,
      requestTimeoutMs: config.debug.requestTimeoutMs,
      firstTokenTimeoutMs: config.debug.firstTokenTimeoutMs,
      maxLogEntries: config.debug.maxLogEntries,
    },
    ollama,
    checks,
  };
}
