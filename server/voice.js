import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, projectRoot } from './config.js';

const voiceRoot = join(projectRoot, 'GPT-SoVITS-v3lora-20250228');
const voiceCacheRoot = join(projectRoot, 'data', 'voice-cache');
let voiceProcess = null;
let startingVoice = null;
let synthesisQueue = Promise.resolve();

async function serviceReady(baseUrl, timeoutMs = 1200) {
  try {
    const result = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(timeoutMs) });
    return result.status < 500;
  } catch { return false; }
}

async function ensureVoiceService(config) {
  if (await serviceReady(config.voice.baseUrl)) return;
  if (startingVoice) return startingVoice;
  startingVoice = (async () => {
    const python = join(voiceRoot, 'runtime', 'python.exe');
    const api = join(voiceRoot, 'api_v2.py');
    if (!existsSync(python) || !existsSync(api)) throw new Error('GPT-SoVITS 运行文件不完整');
    const endpoint = new URL(config.voice.baseUrl);
    voiceProcess = spawn(python, [api, '-a', endpoint.hostname, '-p', endpoint.port || '9880'], {
      cwd: voiceRoot,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        HF_HOME: join(voiceRoot, '.cache', 'huggingface'),
        TRANSFORMERS_CACHE: join(voiceRoot, '.cache', 'huggingface', 'transformers'),
        XDG_CACHE_HOME: join(voiceRoot, '.cache'),
      },
    });
    voiceProcess.once('exit', () => { voiceProcess = null; });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await serviceReady(config.voice.baseUrl, 800)) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    throw new Error('GPT-SoVITS 启动超过 120 秒，请检查显存或运行日志');
  })().finally(() => { startingVoice = null; });
  return startingVoice;
}

function referencePath(config) {
  const configured = config.voice.refAudioPath;
  if (!configured) return null;
  const resolved = resolve(voiceRoot, configured);
  if (resolved !== voiceRoot && !resolved.startsWith(`${voiceRoot}${sep}`)) throw new Error('参考音频必须位于 GPT-SoVITS 文件夹内');
  if (isAbsolute(configured) || !existsSync(resolved)) throw new Error('找不到配置的参考音频');
  return resolved;
}

export async function voiceStatus() {
  const config = await loadConfig();
  let referenceReady = false;
  try { referenceReady = Boolean(referencePath(config)); } catch { /* Display missing reference as unavailable. */ }
  let ready = false;
  if (referenceReady) {
    ready = await serviceReady(config.voice.baseUrl);
  }
  return { referenceReady, serviceReady: ready, available: referenceReady && ready };
}

async function pruneVoiceCache(config) {
  await mkdir(voiceCacheRoot, { recursive: true });
  const files = await readdir(voiceCacheRoot, { withFileTypes: true });
  const entries = (await Promise.all(files
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.wav$/u.test(entry.name))
    .map(async (entry) => {
      const path = join(voiceCacheRoot, entry.name);
      const details = await stat(path);
      return { path, size: details.size, usedAt: details.atimeMs || details.mtimeMs };
    })))
    .sort((left, right) => right.usedAt - left.usedAt);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let remainingFiles = entries.length;
  for (let index = entries.length - 1; index >= 0 && (remainingFiles > config.voice.cacheMaxFiles || totalBytes > config.voice.cacheMaxBytes); index -= 1) {
    await unlink(entries[index].path).catch(() => {});
    totalBytes -= entries[index].size;
    remainingFiles -= 1;
  }
}

async function synthesizeVoiceInternal(text) {
  const config = await loadConfig();
  const refAudioPath = referencePath(config);
  if (!refAudioPath) throw new Error('请在配置文件中设置 voice.refAudioPath');
  const reference = await stat(refAudioPath);
  const cacheKey = createHash('sha256').update(JSON.stringify({
    text,
    textLang: config.voice.textLang,
    promptLang: config.voice.promptLang,
    promptText: config.voice.promptText,
    refAudioPath: config.voice.refAudioPath,
    refSize: reference.size,
    refModifiedAt: reference.mtimeMs,
  })).digest('hex');
  const cachePath = join(voiceCacheRoot, `${cacheKey}.wav`);
  try {
    const audio = await readFile(cachePath);
    const now = new Date();
    await utimes(cachePath, now, now).catch(() => {});
    return { audio, cacheHit: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await ensureVoiceService(config);
  const upstream = await fetch(`${config.voice.baseUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      text_lang: config.voice.textLang,
      ref_audio_path: refAudioPath,
      prompt_lang: config.voice.promptLang,
      prompt_text: config.voice.promptText,
      text_split_method: 'cut5',
      media_type: 'wav',
      streaming_mode: false,
      parallel_infer: false,
      split_bucket: false,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!upstream.ok) throw new Error(`GPT-SoVITS 返回 ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`);
  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.includes('audio')) throw new Error('GPT-SoVITS 没有返回音频');
  const declaredSize = Number(upstream.headers.get('content-length') || 0);
  if (declaredSize > 33554432) throw new Error('GPT-SoVITS 返回的音频超过 32MB 安全限制');
  const audio = Buffer.from(await upstream.arrayBuffer());
  if (audio.length > 33554432) throw new Error('GPT-SoVITS 返回的音频超过 32MB 安全限制');
  await mkdir(voiceCacheRoot, { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, audio);
  await rename(temporaryPath, cachePath);
  await pruneVoiceCache(config);
  return { audio, cacheHit: false };
}

export function synthesizeVoice(text) {
  const task = () => synthesizeVoiceInternal(text);
  const result = synthesisQueue.then(task, task);
  synthesisQueue = result.then(() => undefined, () => undefined);
  return result;
}
