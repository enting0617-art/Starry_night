import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'emojis.sqlite'));
database.exec(`
  CREATE TABLE IF NOT EXISTS chat_images (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_chat_images_last_used ON chat_images(last_used_at);
`);

const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function cleanup(maxFiles, maxBytes) {
  let stats = database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM chat_images').get();
  const oldest = database.prepare('SELECT id, byte_size AS byteSize FROM chat_images ORDER BY last_used_at ASC, created_at ASC');
  const remove = database.prepare('DELETE FROM chat_images WHERE id = ?');
  for (const item of oldest.iterate()) {
    if (stats.count <= maxFiles && stats.bytes <= maxBytes) break;
    remove.run(item.id);
    stats = { count: stats.count - 1, bytes: stats.bytes - item.byteSize };
  }
}

export async function saveChatImage({ fileName, mimeType, base64 }) {
  const config = await loadConfig();
  if (!allowedTypes.has(mimeType)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。');
  const normalized = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!normalized || normalized.length > Math.ceil(config.vision.maxImageBytes * 4 / 3) + 16) throw new Error('图片为空或超过大小限制。');
  const imageData = Buffer.from(normalized, 'base64');
  if (!imageData.length || imageData.length > config.vision.maxImageBytes) throw new Error(`图片不能超过 ${Math.round(config.vision.maxImageBytes / 1048576)}MB。`);
  const sha256 = createHash('sha256').update(imageData).digest('hex');
  const existing = database.prepare('SELECT id FROM chat_images WHERE sha256 = ?').get(sha256);
  if (existing) {
    database.prepare('UPDATE chat_images SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id);
    return { id: existing.id, byteSize: imageData.length, mimeType };
  }
  const id = randomUUID();
  database.prepare('INSERT INTO chat_images (id, file_name, mime_type, image_data, byte_size, sha256) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, String(fileName || 'image').slice(0, 180), mimeType, imageData, imageData.length, sha256);
  cleanup(config.vision.maxStoredImages, config.vision.maxStoredBytes);
  return { id, byteSize: imageData.length, mimeType };
}

export function getChatImage(id) {
  const image = database.prepare('SELECT id, file_name AS fileName, mime_type AS mimeType, image_data AS imageData, byte_size AS byteSize, sha256 FROM chat_images WHERE id = ?').get(String(id || ''));
  if (image) database.prepare('UPDATE chat_images SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(image.id);
  return image ? { ...image, imageData: Buffer.from(image.imageData) } : undefined;
}
