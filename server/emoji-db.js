import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectRoot } from './config.js';

const databasePath = join(projectRoot, 'data', 'emojis.sqlite');
const sourceDirectory = join(projectRoot, 'emojis');
const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS emojis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    source_modified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_emojis_description ON emojis(description);
  CREATE INDEX IF NOT EXISTS idx_emojis_file_name ON emojis(file_name);
`);

const mimeTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (mimeTypes.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

export function listEmojis({ query = '', limit = 500, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const search = `%${String(query).trim()}%`;
  const rows = database.prepare(`
    SELECT id, file_name AS fileName, mime_type AS mimeType, byte_size AS byteSize,
           description, sha256, created_at AS createdAt, updated_at AS updatedAt
    FROM emojis
    WHERE (? = '%%' OR file_name LIKE ? OR description LIKE ?)
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `).all(search, search, search, safeLimit, safeOffset);
  const total = database.prepare(`SELECT COUNT(*) AS count FROM emojis WHERE (? = '%%' OR file_name LIKE ? OR description LIKE ?)`).get(search, search, search).count;
  return { rows, total };
}

export function getEmoji(id) {
  const emoji = database.prepare(`SELECT id, file_name AS fileName, mime_type AS mimeType, image_data AS imageData, description, sha256 FROM emojis WHERE id = ?`).get(Number(id));
  return emoji ? { ...emoji, imageData: Buffer.from(emoji.imageData) } : undefined;
}

export function updateEmojiDescription(id, description) {
  const result = database.prepare(`UPDATE emojis SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(String(description || '').trim(), Number(id));
  return result.changes > 0;
}

export function getEmojiStats() {
  return database.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS totalBytes,
    SUM(CASE WHEN description = '' OR description LIKE '来自本地表情包：%' THEN 1 ELSE 0 END) AS pendingDescriptions FROM emojis`).get();
}

export function listEmojiDescriptionCandidates({ overwrite = false, limit = 500 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  return database.prepare(`SELECT id FROM emojis WHERE (? = 1 OR description = '' OR description LIKE '来自本地表情包：%') ORDER BY id ASC LIMIT ?`)
    .all(overwrite ? 1 : 0, safeLimit);
}

function textPieces(value) {
  const normalized = String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const pieces = new Set();
  for (let index = 0; index < normalized.length; index += 1) {
    pieces.add(normalized[index]);
    if (index + 1 < normalized.length) pieces.add(normalized.slice(index, index + 2));
  }
  return pieces;
}

export function findAssistantEmojiCandidates(text, limit = 24) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 4), 80);
  const queryPieces = textPieces(text);
  const rows = database.prepare(`SELECT id, description FROM emojis
    WHERE description <> '' AND description NOT LIKE '来自本地表情包：%' ORDER BY id ASC`).all();
  return rows.map((row) => {
    let score = 0;
    for (const piece of textPieces(row.description)) if (queryPieces.has(piece)) score += piece.length === 2 ? 3 : 1;
    return { ...row, score };
  }).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, safeLimit).map((row) => ({ id: row.id, description: row.description }));
}

export async function importEmojiDirectory() {
  const files = await walk(sourceDirectory);
  const existing = database.prepare(`SELECT id, sha256 FROM emojis WHERE sha256 = ?`);
  const insert = database.prepare(`
    INSERT INTO emojis (file_name, mime_type, image_data, byte_size, sha256, description, source_modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  let skipped = 0;
  for (const path of files) {
    const data = await readFile(path);
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (existing.get(sha256)) {
      skipped += 1;
      continue;
    }
    const info = await stat(path);
    const fileName = path.slice(sourceDirectory.length + 1).replaceAll('\\', '/');
    const extension = extname(path).toLowerCase();
    insert.run(fileName, mimeTypes.get(extension), data, data.length, sha256, `来自本地表情包：${fileName}`, info.mtime.toISOString());
    imported += 1;
  }
  return { scanned: files.length, imported, skipped, ...getEmojiStats() };
}
