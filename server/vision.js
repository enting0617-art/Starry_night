import { loadConfig } from './config.js';
import { getEmoji, listEmojiDescriptionCandidates, updateEmojiDescription } from './emoji-db.js';

let modelCache = { expiresAt: 0, models: [] };
let batchJob = { status: 'idle', total: 0, processed: 0, updated: 0, failed: 0, currentId: null, errors: [] };

export async function listVisionModels(force = false) {
  if (!force && modelCache.expiresAt > Date.now()) return modelCache.models;
  const config = await loadConfig();
  const tagsResponse = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(10000) });
  if (!tagsResponse.ok) throw new Error(`Ollama 返回 ${tagsResponse.status}`);
  const tags = await tagsResponse.json();
  const models = [];
  for (const item of tags.models || []) {
    try {
      const showResponse = await fetch(`${config.ollamaBaseUrl}/api/show`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: item.name }), signal: AbortSignal.timeout(15000),
      });
      if (!showResponse.ok) continue;
      const detail = await showResponse.json();
      if (detail.capabilities?.includes('vision')) models.push({ name: item.name, size: item.size, capabilities: detail.capabilities, details: item.details });
    } catch { /* One invalid model must not hide the others. */ }
  }
  modelCache = { expiresAt: Date.now() + 30000, models };
  return models;
}

export async function describeImage({ model, imageData, prompt }) {
  const config = await loadConfig();
  if (!Buffer.isBuffer(imageData) || imageData.length > config.vision.maxImageBytes) throw new Error('图片为空或超过视觉识别大小限制。');
  const visionModels = await listVisionModels();
  if (!visionModels.some((item) => item.name === model)) throw new Error(`${model} 不是当前可用的视觉模型。`);
  const upstream = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false,
      messages: [{ role: 'user', content: prompt || config.vision.descriptionPrompt, images: [imageData.toString('base64')] }],
      options: { temperature: 0.15, num_predict: 100 },
    }),
    signal: AbortSignal.timeout(config.debug.requestTimeoutMs),
  });
  if (!upstream.ok) throw new Error(`Ollama 返回 ${upstream.status}: ${await upstream.text()}`);
  const result = await upstream.json();
  const description = String(result.message?.content || '').replace(/^([“"']|描述[:：]?\s*)|[”"']$/g, '').trim().slice(0, 120);
  if (!description) throw new Error('模型没有返回描述。');
  return description;
}

export function getVisionBatchStatus() {
  return { ...batchJob, errors: [...batchJob.errors] };
}

export async function startVisionBatch({ model, overwrite = false, limit }) {
  if (batchJob.status === 'running' || batchJob.status === 'stopping') throw new Error('已有批量识别任务正在运行。');
  const config = await loadConfig();
  const safeLimit = Math.min(Math.max(Number(limit) || config.vision.batchMaxItems, 1), config.vision.batchMaxItems);
  const candidates = listEmojiDescriptionCandidates({ overwrite, limit: safeLimit });
  batchJob = { status: 'running', model, overwrite: Boolean(overwrite), total: candidates.length, processed: 0, updated: 0, failed: 0, currentId: null, startedAt: new Date().toISOString(), finishedAt: null, errors: [], stopRequested: false };
  void (async () => {
    for (const candidate of candidates) {
      if (batchJob.stopRequested) break;
      batchJob.currentId = candidate.id;
      try {
        const emoji = getEmoji(candidate.id);
        if (!emoji) throw new Error('表情不存在');
        const description = await describeImage({ model, imageData: emoji.imageData, prompt: config.vision.descriptionPrompt });
        updateEmojiDescription(candidate.id, description);
        batchJob.updated += 1;
      } catch (error) {
        batchJob.failed += 1;
        batchJob.errors.unshift({ id: candidate.id, message: error.message });
        batchJob.errors.splice(20);
      } finally {
        batchJob.processed += 1;
      }
    }
    batchJob.currentId = null;
    batchJob.status = batchJob.stopRequested ? 'stopped' : 'completed';
    batchJob.finishedAt = new Date().toISOString();
  })();
  return getVisionBatchStatus();
}

export function stopVisionBatch() {
  if (batchJob.status === 'running') {
    batchJob.stopRequested = true;
    batchJob.status = 'stopping';
  }
  return getVisionBatchStatus();
}
