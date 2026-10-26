import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectRoot } from './config.js';

const defaultSource = join(homedir(), 'Downloads', 'python-3.15-docs-text', 'python-3.15-docs-text');
const knowledgeRoot = join(projectRoot, 'knowledge', 'python', '3.15');
const databasePath = join(knowledgeRoot, 'index.db');
const manifestPath = join(projectRoot, 'knowledge', 'python', 'manifest.json');
let ready = false;
let indexing = null;

async function textFiles(root) {
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.txt') files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}

function chunks(text, fileName) {
  const paragraphs = String(text || '').replace(/\r\n/gu, '\n').split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const result = [];
  let content = '';
  let heading = fileName;
  for (const paragraph of paragraphs) {
    const firstLine = paragraph.split('\n')[0].trim();
    if (firstLine.length > 2 && firstLine.length < 120 && (/^[A-Z][^.!?]{2,}$/u.test(firstLine) || /^[-=]{3,}$/u.test(paragraph.split('\n')[1] || ''))) heading = firstLine;
    if (content && content.length + paragraph.length > 1900) {
      result.push({ heading, content });
      content = content.slice(-250);
    }
    content += `${content ? '\n\n' : ''}${paragraph}`;
  }
  if (content.trim()) result.push({ heading, content: content.trim() });
  return result;
}

async function sourceSignature(files) {
  let bytes = 0;
  let newest = 0;
  for (const file of files) {
    const info = await stat(file);
    bytes += info.size;
    newest = Math.max(newest, info.mtimeMs);
  }
  return `${files.length}:${bytes}:${Math.round(newest)}`;
}

async function readManifest() {
  try { return JSON.parse(await readFile(manifestPath, 'utf8')); } catch { return {}; }
}

export async function initializePythonKnowledge({ force = false } = {}) {
  if (indexing) return indexing;
  indexing = (async () => {
    const source = process.env.PYTHON_DOCS_PATH || defaultSource;
    if (!existsSync(source)) return { ready: false, reason: 'source-not-found', source };
    const files = await textFiles(source);
    const signature = await sourceSignature(files);
    const manifest = await readManifest();
    if (!force && existsSync(databasePath) && manifest.signature === signature) {
      ready = true;
      return { ready: true, imported: false, files: manifest.files, chunks: manifest.chunks, source };
    }
    await mkdir(knowledgeRoot, { recursive: true });
    const database = new DatabaseSync(databasePath);
    try {
      database.exec('PRAGMA journal_mode = WAL; DROP TABLE IF EXISTS python_docs; CREATE VIRTUAL TABLE python_docs USING fts5(path UNINDEXED, heading, content, tokenize="unicode61 remove_diacritics 2");');
      const insert = database.prepare('INSERT INTO python_docs(path, heading, content) VALUES (?, ?, ?)');
      let count = 0;
      database.exec('BEGIN');
      try {
        for (const file of files) {
          const path = relative(source, file).replaceAll('\\', '/');
          const text = await readFile(file, 'utf8');
          for (const chunk of chunks(text, path)) { insert.run(path, chunk.heading, chunk.content); count += 1; }
        }
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      const nextManifest = { language: 'python', version: '3.15', source, files: files.length, chunks: count, signature, indexedAt: new Date().toISOString() };
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
      ready = true;
      return { ready: true, imported: true, files: files.length, chunks: count, source };
    } finally { database.close(); }
  })();
  try { return await indexing; } finally { indexing = null; }
}

function queryTerms(query) {
  const ignored = new Set(['python', 'code', 'file', 'help', 'please', 'should', 'what', 'how', '使用', '代码', '文件']);
  return [...new Set(String(query || '').match(/[A-Za-z_][A-Za-z0-9_.-]{1,60}/gu) || [])]
    .flatMap((term) => term.split(/[.-]/u)).map((term) => term.toLowerCase()).filter((term) => term.length > 1 && !ignored.has(term)).slice(0, 10);
}

export function searchPythonKnowledge(query, limit = 5) {
  if (!ready || !existsSync(databasePath)) return [];
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    return database.prepare("SELECT path, heading, snippet(python_docs, 2, '[', ']', ' … ', 32) AS excerpt, bm25(python_docs) AS score FROM python_docs WHERE python_docs MATCH ? ORDER BY score LIMIT ?").all(match, Math.max(1, Math.min(10, Number(limit) || 5)));
  } finally { database.close(); }
}

export function pythonKnowledgeStatus() {
  return { ready, databasePath, source: process.env.PYTHON_DOCS_PATH || defaultSource };
}
