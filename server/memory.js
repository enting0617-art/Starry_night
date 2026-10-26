import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectRoot } from './config.js';
import { readMemoryItems, replaceMemoryItems } from './memory-store.js';
import { deduplicateItems, duplicateScore, findDuplicate } from './deduplication.js';

const memoryPath = join(projectRoot, 'data', 'memories.json');
let writeQueue = Promise.resolve();

async function readMemories() {
  try {
    const data = readMemoryItems('memory');
    if (data.length) return data;
    const legacy = JSON.parse(await readFile(memoryPath, 'utf8'));
    return Array.isArray(legacy) ? legacy : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function saveMemories(memories) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(memoryPath), { recursive: true });
    const temporary = `${memoryPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(memories, null, 2)}\n`, 'utf8');
    await rename(temporary, memoryPath);
    replaceMemoryItems('memory', memories);
  });
  return writeQueue;
}

function words(text) {
  return new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
}

function lexicalScore(query, text) {
  const queryWords = words(query);
  const targetWords = words(text);
  if (!queryWords.size || !targetWords.size) return 0;
  let overlap = 0;
  for (const word of queryWords) if (targetWords.has(word)) overlap += 1;
  return overlap / Math.sqrt(queryWords.size * targetWords.size);
}

export function isUsableMemory(memory) {
  const text = String(memory?.text || '').trim();
  if (text.length < 2 || text.length > 240) return false;
  if (/\.(png|jpe?g|gif|webp)$/i.test(text)) return false;
  if (/^(简短事实|友好|对话邀请|可能的偏好|积极的互动意愿|陪伴的期待)$/u.test(text)) return false;
  if (/(我会一直在这里为你服务|我可以分享|我会继续陪着你|希望用户|提供帮助|探索星空下的世界)/u.test(text)) return false;
  return true;
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] ** 2;
    right += b[index] ** 2;
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export function withoutEmbedding(memory) {
  const copy = { ...memory };
  delete copy.embedding;
  return copy;
}

async function embed(text, config) {
  if (!config.companion.embeddingModel) return null;
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.companion.embeddingModel, input: text }),
      signal: AbortSignal.timeout(Math.min(config.debug.requestTimeoutMs, 30000)),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.embeddings?.[0] || null;
  } catch {
    return null;
  }
}

export async function listMemories() {
  return (await readMemories()).filter(isUsableMemory);
}

export async function findRelevantMemories(query, config) {
  if (!config.companion.memoryEnabled) return [];
  const memories = await readMemories();
  const queryEmbedding = await embed(query, config);
  return memories
    .filter(isUsableMemory)
    .map((memory) => ({
      ...memory,
      score: queryEmbedding && memory.embedding ? cosine(queryEmbedding, memory.embedding) : lexicalScore(query, memory.text),
    }))
    .filter((memory) => memory.score > 0 || memories.length <= config.companion.retrievalCount)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, config.companion.retrievalCount)
    .map(withoutEmbedding);
}

export async function removeMemory(id) {
  const memories = await readMemories();
  const filtered = memories.filter((memory) => memory.id !== id);
  if (filtered.length === memories.length) return false;
  await saveMemories(filtered);
  return true;
}

export async function updateMemory(id, changes = {}) {
  const memories = await readMemories();
  const memory = memories.find((item) => item.id === id);
  if (!memory) return null;
  if (Object.hasOwn(changes, 'text')) {
    const text = String(changes.text || '').replace(/\s+/g, ' ').trim();
    if (!isUsableMemory({ text })) throw new Error('记忆内容需要是 2 至 240 个字的稳定事实。');
    memory.text = text;
  }
  if (Object.hasOwn(changes, 'pinned')) memory.pinned = Boolean(changes.pinned);
  memory.updatedAt = new Date().toISOString();
  const result = deduplicateItems(memories);
  await saveMemories(result.items);
  const retained = result.items.find((item) => item.id === id) || result.items.find((item) => duplicateScore(item.text, memory.text) >= 0.88);
  return retained ? withoutEmbedding(retained) : null;
}

export async function deduplicateMemories() {
  const memories = await readMemories();
  const result = deduplicateItems(memories);
  if (result.removed) await saveMemories(result.items);
  return { before: memories.length, after: result.items.length, removed: result.removed };
}

export async function saveMemoryFacts(values, config) {
  const facts = (Array.isArray(values) ? values : []).map(String).map((item) => item.replace(/\s+/gu, ' ').trim())
    .filter((item) => item.startsWith('用户') && isUsableMemory({ text: item })).slice(0, 8);
  if (!facts.length) return { received: 0, saved: 0, memories: (await listMemories()).map(withoutEmbedding) };
  const memories = await readMemories();
  let saved = 0;
  for (const text of facts) {
    const duplicate = findDuplicate(memories, text);
    if (duplicate) {
      if (!duplicate.pinned && text.length > duplicate.text.length) { duplicate.text = text; duplicate.embedding = await embed(text, config); }
      duplicate.updatedAt = new Date().toISOString();
      continue;
    }
    const now = new Date().toISOString();
    memories.push({ id: globalThis.crypto.randomUUID(), text, createdAt: now, updatedAt: now, embedding: await embed(text, config) });
    saved += 1;
  }
  const deduplicated = deduplicateItems(memories).items.slice(-config.companion.maxMemories);
  await saveMemories(deduplicated);
  return { received: facts.length, saved, memories: deduplicated.filter(isUsableMemory).map(withoutEmbedding) };
}

export async function extractAndSaveMemories({ userText, assistantText, model, config }) {
  if (!config.companion.memoryEnabled || !userText || !assistantText) return;
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{
          role: 'user',
          content: `你是严格的用户记忆提取器。只提取人类用户本人明确表达、且未来仍有用的事实、偏好、计划或关系。每条必须写成“用户……”的第三人称事实。绝不把助手说的话、助手人设、问候、临时情绪、文件名、表情编号、推测、密码、密钥、财务或医疗敏感信息保存为用户记忆。只返回 JSON：{"memories":["用户明确表达的简短事实"]}，最多3条；没有可靠事实必须返回 {"memories":[]}。\n\n人类用户消息：${userText}\nAI助手星空回复：${assistantText}`,
        }],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(config.debug.requestTimeoutMs),
    });
    if (!response.ok) return;
    const data = await response.json();
    const parsed = JSON.parse(data.message?.content || '{}');
    const facts = Array.isArray(parsed.memories)
      ? parsed.memories.map(String).map((item) => item.trim()).filter((item) => item.startsWith('用户') && isUsableMemory({ text: item })).slice(0, 3)
      : [];
    await saveMemoryFacts(facts, config);
  } catch (error) {
    console.warn(`Memory extraction skipped: ${error.message}`);
  }
}
