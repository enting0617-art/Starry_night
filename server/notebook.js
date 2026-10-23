import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfig, projectRoot } from './config.js';
import { listMemories } from './memory.js';
import { readMemoryItems, replaceMemoryItems } from './memory-store.js';

const notebookPath = join(projectRoot, 'data', 'xingkong-notes.json');
const categories = new Set(['identity', 'preference', 'plan', 'shared', 'other']);
let writeQueue = Promise.resolve();

async function readNotes() {
  try {
    const items = readMemoryItems('notebook');
    if (items.length) return items;
    const value = JSON.parse(await readFile(notebookPath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function saveNotes(notes) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(notebookPath), { recursive: true });
    const temporary = `${notebookPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
    await rename(temporary, notebookPath);
    replaceMemoryItems('notebook', notes);
  });
  return writeQueue;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function pieces(value) {
  const text = normalize(value);
  const result = new Set();
  for (let index = 0; index < text.length; index += 1) {
    result.add(text[index]);
    if (index + 1 < text.length) result.add(text.slice(index, index + 2));
  }
  return result;
}

function score(query, text) {
  const queryPieces = pieces(query);
  if (!queryPieces.size) return 0;
  let total = 0;
  for (const piece of pieces(text)) if (queryPieces.has(piece)) total += piece.length === 2 ? 3 : 1;
  return total;
}

function safeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (text.length < 2) return '';
  if (/(?:password|密码|验证码|token|api[_ -]?key|密钥|银行卡|信用卡)\s*[:：=]/iu.test(text)) return '';
  return text;
}

function identityValue(value) {
  return normalize(value).match(/^用户(?:名叫|叫|的名字是|的名字叫|姓名是|姓名为|希望被称为)(.+)$/u)?.[1] || '';
}

async function importLegacyIdentityNotes(notes) {
  const memories = await listMemories();
  let changed = false;
  for (const memory of memories) {
    if (!/^用户(?:叫|的名字(?:是|叫)|姓名(?:是|为)|希望被称为)/u.test(memory.text)) continue;
    if (notes.some((note) => normalize(note.text) === normalize(memory.text))) continue;
    const now = new Date().toISOString();
    notes.push({ id: globalThis.crypto.randomUUID(), category: 'identity', text: memory.text, pinned: true, source: 'legacy-memory', createdAt: now, updatedAt: now });
    changed = true;
  }
  return changed;
}

export async function listNotebookNotes() {
  const notes = await readNotes();
  if (await importLegacyIdentityNotes(notes)) await saveNotes(notes);
  return notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function findNotebookNotes(query) {
  const config = await loadConfig();
  const notes = await listNotebookNotes();
  const pinned = notes.filter((note) => note.pinned);
  const relevant = notes.filter((note) => !note.pinned).map((note) => ({ ...note, relevance: score(query, note.text) }))
    .sort((a, b) => b.relevance - a.relevance || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, config.notebook.retrievalCount);
  return [...pinned, ...relevant].slice(0, config.notebook.maxContextNotes);
}

export async function applyNotebookCommands(output) {
  const config = await loadConfig();
  const notes = await readNotes();
  const commands = [...String(output || '').matchAll(/\[\[NOTE:([a-z]+)\|([^\]\r\n]+)\]\]/giu)];
  let saved = 0;
  for (const command of commands) {
    const category = categories.has(command[1].toLowerCase()) ? command[1].toLowerCase() : 'other';
    const text = safeText(command[2]);
    if (!text) continue;
    const identity = category === 'identity' ? identityValue(text) : '';
    const duplicate = notes.find((note) => normalize(note.text) === normalize(text) || (identity && note.category === 'identity' && identityValue(note.text) === identity));
    if (duplicate) {
      duplicate.updatedAt = new Date().toISOString();
      duplicate.pinned ||= category === 'identity';
      continue;
    }
    const now = new Date().toISOString();
    notes.push({ id: globalThis.crypto.randomUUID(), category, text, pinned: category === 'identity', source: 'xingkong', createdAt: now, updatedAt: now });
    saved += 1;
  }
  if (commands.length) await saveNotes(notes.slice(-config.notebook.maxNotes));
  return { commands: commands.length, saved };
}

export async function removeNotebookNote(id) {
  const notes = await readNotes();
  const filtered = notes.filter((note) => note.id !== id);
  if (filtered.length === notes.length) return false;
  await saveNotes(filtered);
  return true;
}

export async function updateNotebookNote(id, changes = {}) {
  const notes = await readNotes();
  const note = notes.find((item) => item.id === id);
  if (!note) return null;
  if (Object.hasOwn(changes, 'text')) {
    const text = safeText(changes.text);
    if (!text) throw new Error('笔记内容无效或包含不应保存的敏感信息。');
    note.text = text;
  }
  if (Object.hasOwn(changes, 'pinned')) note.pinned = Boolean(changes.pinned);
  if (Object.hasOwn(changes, 'category') && categories.has(String(changes.category))) note.category = String(changes.category);
  note.updatedAt = new Date().toISOString();
  await saveNotes(notes);
  return note;
}
